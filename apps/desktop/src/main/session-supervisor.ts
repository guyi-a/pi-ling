import { randomUUID } from "node:crypto";

import type { RuntimeAdapter } from "@pi-ling/runtime-contracts";
import type {
  AgentStatus,
  ApprovalMode,
  ChangedFile,
  ChangesSource,
  CreateSessionRequest,
  FileDiff,
  RuntimeKind,
  SessionActivation,
  SessionArchiveResult,
  SessionSummary,
  StreamFrameEnvelope,
  TimelineEnvelope,
  TimelineSnapshot,
  WorkspaceListEntry,
  WorkspaceSummary,
} from "@pi-ling/contracts";

import { DshAgentSession } from "./dsh-agent-session.js";
import { gitDiff, gitScopedFiles } from "./git-diff.js";
import { PiAgentSession } from "./pi-agent-session.js";
import { RunMessageBuffer } from "./run-message-buffer.js";
import { SessionStore } from "./session-store/session-store.js";

type ApprovalDecision = {
  approved: boolean;
  effectDigest: string;
  reason?: string;
};

interface ActiveSession {
  readonly sessionId: string;
  readonly status: AgentStatus;
  snapshot(): TimelineSnapshot;
  startPrompt(runId: string, prompt: string): void;
  cancel(runId: string): boolean | Promise<boolean>;
  resolveApproval(
    callId: string,
    decision: ApprovalDecision,
  ): Promise<boolean>;
  changedFiles(): Promise<ChangedFile[]>;
  diff(path: string): Promise<FileDiff | undefined>;
  setApprovalMode(mode: ApprovalMode): SessionSummary;
  dispose(): Promise<void>;
}

export class SessionSupervisor {
  readonly #store: SessionStore;
  readonly #emit: (envelope: TimelineEnvelope) => void;
  readonly #dshRuntime: RuntimeAdapter | undefined;
  readonly #emptySessionId = randomUUID();
  readonly #sessions = new Map<string, ActiveSession>();
  readonly #runOwners = new Map<string, string>();
  readonly #workspaceRuns = new Map<string, string>();
  readonly #buffer: RunMessageBuffer;
  #selectedSessionId: string | undefined;
  #activationRevision = 0;

  constructor(
    store: SessionStore,
    emit: (envelope: TimelineEnvelope) => void,
    emitFrame: (frame: StreamFrameEnvelope) => void = () => {},
    dshRuntime?: RuntimeAdapter,
  ) {
    this.#store = store;
    this.#emit = emit;
    this.#dshRuntime = dshRuntime;
    this.#buffer = new RunMessageBuffer(emitFrame);
  }

  get availableRuntimes(): RuntimeKind[] {
    return this.#dshRuntime ? ["native", "dsh"] : ["native"];
  }

  async initialize(): Promise<void> {
    for (const session of this.#store.listSessions()) {
      if (session.runtimeKind === "dsh" && !this.#dshRuntime) continue;
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
    if (runtimeKind === "claude") {
      throw new Error("Claude Runtime is not enabled");
    }
    const session = this.#store.createSession({
      ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      ...(request.workspaceRoot
        ? { workspaceRoot: request.workspaceRoot }
        : {}),
      ...(request.title ? { title: request.title } : {}),
      runtimeKind,
      runtimeVersion:
        runtimeKind === "dsh" ? "0.1.3-alpha.1" : "0.1.0",
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
    if (session.runtimeKind === "claude") {
      throw new Error("Claude Runtime is not enabled");
    }
    const activationRevision = ++this.#activationRevision;
    this.#selectedSessionId = sessionId;
    let active = this.#sessions.get(sessionId);
    if (!active) {
      active = await this.#open(session);
      this.#sessions.set(sessionId, active);
    }
    this.#store.touchWorkspace(session.workspaceId);
    return {
      session: this.#store.getSession(sessionId)!,
      status: active.status,
      snapshot: active.snapshot(),
      bufferFrames: this.#buffer.snapshot(sessionId),
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
    const next = workspace?.sessions.find(
      (candidate) =>
        candidate.runtimeKind !== "dsh" || Boolean(this.#dshRuntime),
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
        provider: "deepseek",
        model: "deepseek-v4-pro",
        configured: Boolean(process.env["DEEPSEEK_API_KEY"]?.trim()),
        approvalMode: "manual",
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

  startPrompt(runId: string, prompt: string, sessionId?: string): void {
    const targetId = sessionId ?? this.#selectedSessionId;
    if (!targetId) throw new Error("Create or select a session first");
    const active = this.#sessions.get(targetId);
    if (!active) throw new Error(`Session is not active: ${targetId}`);
    const session = this.#store.getSession(targetId);
    if (!session) throw new Error(`Session not found: ${targetId}`);
    const workspaceRun = this.#workspaceRuns.get(session.workspaceId);
    if (workspaceRun && workspaceRun !== runId) {
      throw new Error("Another session is already running in this workspace");
    }
    this.#workspaceRuns.set(session.workspaceId, runId);
    this.#runOwners.set(runId, targetId);
    try {
      active.startPrompt(runId, prompt);
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

  setApprovalMode(mode: ApprovalMode): SessionSummary {
    const active = this.#selectedSessionId
      ? this.#sessions.get(this.#selectedSessionId)
      : undefined;
    if (!active) throw new Error("No active session");
    return active.setApprovalMode(mode);
  }

  async switchRuntime(runtimeKind: RuntimeKind): Promise<SessionActivation> {
    if (!this.#selectedSessionId) throw new Error("No active session");
    if (runtimeKind === "dsh" && !this.#dshRuntime) {
      throw new Error("DSH Runtime is not enabled");
    }
    if (runtimeKind === "claude") {
      throw new Error("Claude Runtime is not enabled");
    }
    const sessionId = this.#selectedSessionId;
    const session = this.#store.getSession(sessionId)!;
    if (session.lifecycle === "running" || session.lifecycle === "awaiting_approval") {
      throw new Error("Runtime can only switch while the session is idle");
    }
    if (session.runtimeKind === runtimeKind) return this.activate(sessionId);
    const previousRuntime = session.runtimeKind;
    await this.#shutdownSession(sessionId);
    this.#store.setRuntime(
      sessionId,
      runtimeKind,
      runtimeKind === "dsh" ? "0.1.3-alpha.1" : "0.1.0",
    );
    try {
      return await this.activate(sessionId);
    } catch (error) {
      this.#store.setRuntime(
        sessionId,
        previousRuntime,
        previousRuntime === "dsh" ? "0.1.3-alpha.1" : "0.1.0",
      );
      await this.activate(sessionId);
      throw error;
    }
  }

  async dispose(): Promise<void> {
    for (const sessionId of [...this.#sessions.keys()]) {
      await this.#shutdownSession(sessionId);
    }
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
    return session.runtimeKind === "dsh"
      ? DshAgentSession.open({
          store: this.#store,
          session,
          runtime: this.#dshRuntime!,
          emit,
          buffer: this.#buffer,
          availableRuntimes: this.availableRuntimes,
        })
      : PiAgentSession.open({
          store: this.#store,
          session,
          emit,
          buffer: this.#buffer,
          availableRuntimes: this.availableRuntimes,
        });
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
