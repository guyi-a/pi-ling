import { randomUUID } from "node:crypto";



import { isLlmConfigured } from "@pi-ling/llm-config";
import type { RuntimeAdapter } from "@pi-ling/runtime-contracts";

import { getResolvedLlmConfig } from "./llm-config-store.js";

import type {

  AgentStatus,

  ApprovalMode,

  AskUserAnswer,

  BackgroundTask,

  ComposerMode,

  ChangedFile,

  ChangesSource,

  CreateSessionRequest,

  DiffFileContents,

  FileDiff,

  PromptAttachment,

  RuntimeKind,

  SessionActivation,

  SessionArchiveResult,

  SessionSummary,

  StreamFrameEnvelope,

  TaskUpdatedEvent,

  TimelineEnvelope,

  TimelineSnapshot,

  WorkspaceListEntry,

  WorkspaceSummary,

} from "@pi-ling/contracts";



import type { CodexRuntimeAdapter } from "@pi-ling/codex-runtime";

import { CodexAgentSession } from "./codex-agent-session.js";
import { DshAgentSession } from "./dsh-agent-session.js";

import { gitDiff, gitScopedFiles, gitShowFile, gitShowIndexFile } from "./git-diff.js";

import { PiAgentSession } from "./pi-agent-session.js";

import { RunMessageBuffer } from "./run-message-buffer.js";

import { SessionStore } from "./session-store/session-store.js";
import { readTextForDiff, MAX_DIFF_TEXT_BYTES } from "./workspace-fs.js";
import { TaskRunner } from "./tasks/task-runner.js";

import { projectTimelineSnapshot } from "@pi-ling/session-events";



type ApprovalDecision = {

  approved: boolean;

  effectDigest: string;

  reason?: string;

};



interface ActiveSession {

  readonly sessionId: string;

  readonly status: AgentStatus;

  snapshot(): TimelineSnapshot;

  startPrompt(

    runId: string,

    prompt: string,

    attachments?: PromptAttachment[],

  ): void;

  cancel(runId: string): boolean | Promise<boolean>;

  resolveApproval(

    callId: string,

    decision: ApprovalDecision,

  ): Promise<boolean>;

  resolveQuestion(

    callId: string,

    answers: AskUserAnswer[],

  ): Promise<boolean>;

  changedFiles(): Promise<ChangedFile[]>;

  diff(path: string): Promise<FileDiff | undefined>;

  setApprovalMode(mode: ApprovalMode): SessionSummary;

  setComposerMode(mode: ComposerMode): SessionSummary;

  dispose(): Promise<void>;

}



export class SessionSupervisor {

  readonly #store: SessionStore;

  readonly #emit: (envelope: TimelineEnvelope) => void;

  readonly #emitTaskUpdated: (event: TaskUpdatedEvent) => void;

  readonly #dshRuntime: RuntimeAdapter | undefined;

  readonly #codexRuntime: RuntimeAdapter | undefined;

  readonly #emptySessionId = randomUUID();

  readonly #sessions = new Map<string, ActiveSession>();

  readonly #runOwners = new Map<string, string>();

  readonly #workspaceRuns = new Map<string, string>();

  readonly #buffer: RunMessageBuffer;

  readonly #taskRunner: TaskRunner;

  #selectedSessionId: string | undefined;

  #activationRevision = 0;

  #shuttingDown = false;



  constructor(

    store: SessionStore,

    emit: (envelope: TimelineEnvelope) => void,

    emitFrame: (frame: StreamFrameEnvelope) => void = () => {},

    dshRuntime?: RuntimeAdapter,

    codexRuntime?: RuntimeAdapter,

    emitTaskUpdated: (event: TaskUpdatedEvent) => void = () => {},

  ) {

    this.#store = store;

    this.#emit = emit;

    this.#emitTaskUpdated = emitTaskUpdated;

    this.#dshRuntime = dshRuntime;

    this.#codexRuntime = codexRuntime;

    this.#buffer = new RunMessageBuffer(emitFrame);

    this.#taskRunner = new TaskRunner({

      store,

      onUpdated: (task) => {

        this.#emitTaskUpdated({

          sessionId: task.parentSessionId,

          task,

        });

      },

      onTerminal: async (task) => {

        await this.#handleBackgroundTaskTerminal(task);

      },

    });

  }



  get availableRuntimes(): RuntimeKind[] {

    const runtimes: RuntimeKind[] = ["native"];

    if (this.#dshRuntime) runtimes.push("dsh");

    if (this.#codexRuntime) runtimes.push("codex");

    return runtimes;

  }



  #runtimeVersion(runtimeKind: RuntimeKind): string {

    if (runtimeKind === "dsh") return "0.1.3-alpha.1";

    if (runtimeKind === "codex") return "0.154.0";

    return "0.1.0";

  }



  #isRuntimeAvailable(runtimeKind: RuntimeKind): boolean {

    if (runtimeKind === "dsh") return Boolean(this.#dshRuntime);

    if (runtimeKind === "codex") return Boolean(this.#codexRuntime);

    return true;

  }



  async initialize(): Promise<void> {

    await this.#taskRunner.start();

    for (const session of this.#store.listSessions()) {

      if (!this.#isRuntimeAvailable(session.runtimeKind)) continue;

      try {

        await this.activate(session.id);

        return;

      } catch {

        this.#store.setLifecycle(session.id, "crashed");

      }

    }

  }



  list(): SessionSummary[] {

    return this.#store.listSessions();

  }



  listWorkspaces(includeArchived = false): WorkspaceListEntry[] {

    return this.#store.listWorkspaces(includeArchived);

  }



  addWorkspace(workspaceRoot: string): WorkspaceSummary {

    return this.#store.createWorkspace({ root: workspaceRoot });

  }



  async create(request: CreateSessionRequest): Promise<SessionActivation> {

    const runtimeKind = request.runtimeKind ?? "native";

    if (runtimeKind === "dsh" && !this.#dshRuntime) {

      throw new Error("DSH Runtime is not enabled");

    }

    if (runtimeKind === "codex" && !this.#codexRuntime) {

      throw new Error("Codex Runtime is not enabled");

    }

    const session = this.#store.createSession({

      ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),

      ...(request.workspaceRoot

        ? { workspaceRoot: request.workspaceRoot }

        : {}),

      ...(request.title ? { title: request.title } : {}),

      runtimeKind,

      runtimeVersion: this.#runtimeVersion(runtimeKind),

    });

    try {

      return await this.activate(session.id);

    } catch (error) {

      this.#store.deleteSession(session.id);

      throw error;

    }

  }



  async activate(sessionId: string): Promise<SessionActivation> {

    const session = this.#store.getSession(sessionId);

    if (!session) throw new Error(`Session not found: ${sessionId}`);

    if (session.archivedAt) throw new Error(`Session is archived: ${sessionId}`);

    if (session.runtimeKind === "dsh" && !this.#dshRuntime) {

      throw new Error("DSH Runtime is not enabled");

    }

    if (session.runtimeKind === "codex" && !this.#codexRuntime) {

      throw new Error("Codex Runtime is not enabled");

    }

    const activationRevision = ++this.#activationRevision;

    this.#selectedSessionId = sessionId;

    let active = this.#sessions.get(sessionId);

    if (!active) {

      active = await this.#open(session);

      this.#sessions.set(sessionId, active);

    }

    if (session.lifecycle === "crashed") {

      this.#store.setLifecycle(sessionId, "idle");

    }

    this.#store.touchWorkspace(session.workspaceId);

    return {

      session: this.#store.getSession(sessionId)!,

      status: active.status,

      snapshot: projectTimelineSnapshot(

        sessionId,

        this.#store.loadSessionEvents(sessionId),

        this.#buffer.snapshot(sessionId),

      ),

      bufferFrames: this.#buffer.snapshot(sessionId),

      backgroundTasks: this.#taskRunner.list(sessionId),

      activationRevision,

    };

  }



  async delete(sessionId: string): Promise<void> {

    await this.#shutdownSession(sessionId);

    this.#store.deleteSession(sessionId);

    if (this.#selectedSessionId === sessionId) {

      this.#selectedSessionId = undefined;

      this.#activationRevision += 1;

    }

  }



  setSessionPinned(sessionId: string, pinned: boolean): SessionSummary {

    return this.#store.setSessionPinned(sessionId, pinned);

  }



  async archiveSession(sessionId: string): Promise<SessionArchiveResult> {

    const session = this.#store.archiveSession(sessionId);

    await this.#shutdownSession(sessionId);

    if (this.#selectedSessionId !== sessionId) return { sessionId };

    this.#selectedSessionId = undefined;

    const workspace = this.#store

      .listWorkspaces()

      .find((entry) => entry.id === session.workspaceId);

    const next = workspace?.sessions.find((candidate) =>

      this.#isRuntimeAvailable(candidate.runtimeKind),

    );

    return {

      sessionId,

      ...(next ? { activation: await this.activate(next.id) } : {}),

    };

  }



  restoreSession(sessionId: string): SessionSummary {

    return this.#store.restoreSession(sessionId);

  }



  get status(): AgentStatus {

    const active = this.#selectedSessionId

      ? this.#sessions.get(this.#selectedSessionId)

      : undefined;

    return (

      active?.status ?? {

        runtimeKind: "native",

        availableRuntimes: this.availableRuntimes,

        provider: getResolvedLlmConfig().provider,

        model: getResolvedLlmConfig().model,

        configured: isLlmConfigured(getResolvedLlmConfig()),

        approvalMode: "manual",

        composerMode: "agent",

      }

    );

  }



  snapshot(sessionId = this.#selectedSessionId): TimelineSnapshot {

    if (!sessionId) {

      return {

        sessionId: this.#emptySessionId,

        lastSeq: 0,

        events: [],

      };

    }

    return (

      this.#sessions.get(sessionId)?.snapshot() ??

      this.#store.loadSnapshot(sessionId)

    );

  }



  startPrompt(

    runId: string,

    prompt: string,

    sessionId?: string,

    attachments?: PromptAttachment[],

  ): void {

    const targetId = sessionId ?? this.#selectedSessionId;

    if (!targetId) throw new Error("Create or select a session first");

    const active = this.#sessions.get(targetId);

    if (!active) throw new Error(`Session is not active: ${targetId}`);

    const session = this.#store.getSession(targetId);

    if (!session) throw new Error(`Session not found: ${targetId}`);

    if ((attachments?.length ?? 0) > 0 && session.runtimeKind !== "native") {

      throw new Error("Image attachments are only supported on Native runtime");

    }

    const workspaceRun = this.#workspaceRuns.get(session.workspaceId);

    if (workspaceRun && workspaceRun !== runId) {

      throw new Error("Another session is already running in this workspace");

    }

    this.#workspaceRuns.set(session.workspaceId, runId);

    this.#runOwners.set(runId, targetId);

    try {

      active.startPrompt(runId, prompt, attachments);

    } catch (error) {

      this.#workspaceRuns.delete(session.workspaceId);

      this.#runOwners.delete(runId);

      throw error;

    }

  }



  cancel(runId: string): boolean | Promise<boolean> {

    const sessionId = this.#runOwners.get(runId);

    return sessionId

      ? this.#sessions.get(sessionId)?.cancel(runId) ?? false

      : false;

  }



  resolveApproval(

    callId: string,

    decision: ApprovalDecision,

  ): Promise<boolean> {

    const active = this.#selectedSessionId

      ? this.#sessions.get(this.#selectedSessionId)

      : undefined;

    return active?.resolveApproval(callId, decision) ?? Promise.resolve(false);

  }



  resolveQuestion(

    callId: string,

    answers: AskUserAnswer[],

  ): Promise<boolean> {

    const active = this.#selectedSessionId

      ? this.#sessions.get(this.#selectedSessionId)

      : undefined;

    return active?.resolveQuestion(callId, answers) ?? Promise.resolve(false);

  }



  changedFiles(source: ChangesSource = "agent"): Promise<ChangedFile[]> {

    if (source !== "agent" && source !== "last-agent-turn") {

      const session = this.#selectedSessionId

        ? this.#store.getSession(this.#selectedSessionId)

        : undefined;

      const root = session?.workspace.root;

      if (!root) return Promise.resolve([]);

      return gitScopedFiles(root, source);

    }

    const active = this.#selectedSessionId

      ? this.#sessions.get(this.#selectedSessionId)

      : undefined;

    return active?.changedFiles() ?? Promise.resolve([]);

  }



  diff(

    path: string,

    source: ChangesSource = "agent",

  ): Promise<FileDiff | undefined> {

    if (source !== "agent" && source !== "last-agent-turn") {

      const session = this.#selectedSessionId

        ? this.#store.getSession(this.#selectedSessionId)

        : undefined;

      const root = session?.workspace.root;

      if (!root) return Promise.resolve(undefined);

      return gitDiff(root, path, undefined, source);

    }

    const active = this.#selectedSessionId

      ? this.#sessions.get(this.#selectedSessionId)

      : undefined;

    return active?.diff(path) ?? Promise.resolve(undefined);

  }

  /**
   * 取 diff 的双侧内容，供 MergeView 做带语法高亮的渲染。
   *
   * 与 `diff()` 的拒绝条件保持一致：敏感 / 二进制 / 超大文件一律返回
   * `undefined`，绝不把内容送进 Renderer —— 由调用方回退到 patch 渲染。
   *
   * before 的来源随 scope 变化：agent 改动取持久化的 baseline，
   * git 改动取 `git show`；after 通常是工作区文件（staged 则取 index）。
   */
  async diffFileContents(
    path: string,
    source: ChangesSource = "agent",
  ): Promise<DiffFileContents | undefined> {
    const session = this.#selectedSessionId
      ? this.#store.getSession(this.#selectedSessionId)
      : undefined;
    const root = session?.workspace.root;
    if (!root || !session) return Promise.resolve(undefined);

    // 复用 changedFiles 的元信息（binary / sensitive / tooLarge）做把关
    const files = await this.changedFiles(source);
    const entry = files.find((file) => file.path === path);
    if (!entry) return undefined;
    if (entry.binary || entry.sensitive || entry.tooLarge) return undefined;

    const isAgentScope = source === "agent" || source === "last-agent-turn";

    let before: string | undefined;
    let after: string | undefined;

    if (isAgentScope) {
      const baseline = this.#store
        .loadBaselines(session.id)
        .find((item) => item.path === path);
      // 没有 baseline 说明不是 Agent 改的（或已超出保留范围），回退 patch
      if (!baseline) return undefined;
      before = baseline.content?.toString("utf8") ?? "";
      after = await readTextForDiff(root, path);
    } else if (source === "staged") {
      // staged：HEAD → index
      before = await gitShowFile(root, "HEAD", path);
      after = await gitShowIndexFile(root, path);
    } else if (source === "unstaged") {
      // unstaged：index → 工作区
      before = await gitShowIndexFile(root, path);
      after = await readTextForDiff(root, path);
    } else {
      // uncommitted：HEAD → 工作区
      before = await gitShowFile(root, "HEAD", path);
      after = await readTextForDiff(root, path);
    }

    // `undefined` 只在语义上合理时才归一为空串：
    // - 新增文件（status=added）没有 before
    // - 删除文件（status=deleted）没有 after
    // 其余情况下取不到内容说明是二进制 / 超大 / 读失败 —— 必须回退 patch，
    // 否则会把一个本不该展示的文件渲染成「空 diff」。
    const beforeText = before ?? (entry.status === "added" ? "" : null);
    const afterText = after ?? (entry.status === "deleted" ? "" : null);
    if (beforeText === null || afterText === null) return undefined;

    const total =
      Buffer.byteLength(beforeText, "utf8") +
      Buffer.byteLength(afterText, "utf8");
    if (total > MAX_DIFF_TEXT_BYTES) {
      return { path, before: "", after: "", truncated: true };
    }

    return { path, before: beforeText, after: afterText };
  }



  setApprovalMode(mode: ApprovalMode): SessionSummary {

    const active = this.#selectedSessionId

      ? this.#sessions.get(this.#selectedSessionId)

      : undefined;

    if (!active) throw new Error("No active session");

    return active.setApprovalMode(mode);

  }



  setComposerMode(mode: ComposerMode): SessionSummary {

    const active = this.#selectedSessionId

      ? this.#sessions.get(this.#selectedSessionId)

      : undefined;

    if (!active) throw new Error("No active session");

    return active.setComposerMode(mode);

  }



  async switchRuntime(runtimeKind: RuntimeKind): Promise<SessionActivation> {

    if (!this.#selectedSessionId) throw new Error("No active session");

    if (runtimeKind === "dsh" && !this.#dshRuntime) {

      throw new Error("DSH Runtime is not enabled");

    }

    if (runtimeKind === "codex" && !this.#codexRuntime) {

      throw new Error("Codex Runtime is not enabled");

    }

    const sessionId = this.#selectedSessionId;

    const session = this.#store.getSession(sessionId)!;

    if (

      session.lifecycle === "running" ||

      session.lifecycle === "awaiting_approval" ||

      session.lifecycle === "awaiting_question"

    ) {

      throw new Error("Runtime can only switch while the session is idle");

    }

    if (session.runtimeKind === runtimeKind) return this.activate(sessionId);

    const previousRuntime = session.runtimeKind;

    await this.#shutdownSession(sessionId);

    this.#store.setRuntime(

      sessionId,

      runtimeKind,

      this.#runtimeVersion(runtimeKind),

    );

    try {

      return await this.activate(sessionId);

    } catch (error) {

      this.#store.setRuntime(

        sessionId,

        previousRuntime,

        this.#runtimeVersion(previousRuntime),

      );

      await this.activate(sessionId);

      throw error;

    }

  }



  async dispose(): Promise<void> {

    this.#shuttingDown = true;

    for (const sessionId of [...this.#sessions.keys()]) {

      await this.#shutdownSession(sessionId);

    }

    await this.#taskRunner.shutdown();

    this.#buffer.dispose();

    this.#selectedSessionId = undefined;

  }



  async #open(session: SessionSummary): Promise<ActiveSession> {

    const emit = (envelope: TimelineEnvelope) => {

      if (envelope.event.type === "run_end") {

        this.#releaseRun(envelope.runId, session.workspaceId);

      }

      this.#emit(envelope);

    };

    if (session.runtimeKind === "dsh") {

      return DshAgentSession.open({

        store: this.#store,

        session,

        runtime: this.#dshRuntime!,

        emit,

        buffer: this.#buffer,

        availableRuntimes: this.availableRuntimes,

      });

    }

    if (session.runtimeKind === "codex") {

      return CodexAgentSession.open({

        store: this.#store,

        session,

        runtime: this.#codexRuntime as CodexRuntimeAdapter,

        emit,

        buffer: this.#buffer,

        availableRuntimes: this.availableRuntimes,

      });

    }

    return PiAgentSession.open({

      store: this.#store,

      session,

      emit,

      buffer: this.#buffer,

      availableRuntimes: this.availableRuntimes,

      taskRunner: this.#taskRunner,

      onAutoContinue: () => this.#autoContinueBackgroundTasks(session.id),

    });

  }



  async #handleBackgroundTaskTerminal(task: BackgroundTask): Promise<void> {

    const active = this.#sessions.get(task.parentSessionId);

    if (active instanceof PiAgentSession) {

      await active.notifyBackgroundTask(task);

    }

    if (this.#shuttingDown || task.status === "cancelled") {

      return;

    }

    await this.#autoContinueBackgroundTasks(task.parentSessionId);

  }



  async #autoContinueBackgroundTasks(sessionId: string): Promise<void> {

    if (this.#shuttingDown) return;

    const session = this.#store.getSession(sessionId);

    if (!session) return;

    if (this.#workspaceRuns.get(session.workspaceId)) return;



    const active = this.#sessions.get(sessionId);

    if (!(active instanceof PiAgentSession)) return;



    const runId = randomUUID();

    this.#workspaceRuns.set(session.workspaceId, runId);

    this.#runOwners.set(runId, sessionId);

    try {

      const result = await active.continueBackgroundTasks(runId);

      if (!result.started) {

        this.#releaseRun(runId, session.workspaceId);

      }

    } catch (error) {

      this.#releaseRun(runId, session.workspaceId);

      console.error("Background task continuation failed", error);

    }

  }



  async #shutdownSession(sessionId: string): Promise<void> {

    const active = this.#sessions.get(sessionId);

    if (!active) return;

    await active.dispose();

    this.#sessions.delete(sessionId);

    this.#buffer.clearSession(sessionId);

    for (const [runId, owner] of this.#runOwners) {

      if (owner !== sessionId) continue;

      const workspaceId = this.#store.getSession(sessionId)?.workspaceId;

      this.#releaseRun(runId, workspaceId);

    }

  }



  #releaseRun(runId: string, workspaceId?: string): void {

    this.#runOwners.delete(runId);

    if (workspaceId && this.#workspaceRuns.get(workspaceId) === runId) {

      this.#workspaceRuns.delete(workspaceId);

    }

  }

}

