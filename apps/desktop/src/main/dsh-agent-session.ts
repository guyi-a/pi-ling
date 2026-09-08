import { randomUUID } from "node:crypto";

import { ChangeTracker, Workspace } from "@pi-ling/coding-agent";
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimePermissionOption,
} from "@pi-ling/runtime-contracts";
import type {
  AgentStatus,
  ApprovalMode,
  ApprovalRequest,
  CanonicalMessage,
  ChangedFile,
  FileDiff,
  RuntimeKind,
  SessionSummary,
  TimelineEnvelope,
  TimelineEvent,
  TimelineSnapshot,
} from "@pi-ling/contracts";
import { projectCanonicalMessages, projectTimelineSnapshot } from "@pi-ling/session-events";

import { evaluateDshApproval } from "./dsh-approval-policy.js";
import {
  isFileAffectingDshTool,
  resolveToolWorkspacePath,
} from "./dsh-tool-changes.js";
import { diffLineStats } from "./diff-stats.js";
import { RunMessageBuffer } from "./run-message-buffer.js";
import { SessionStore } from "./session-store/session-store.js";

interface PendingPermission {
  runId: string;
  turnId: string;
  runtimePermissionId: string;
  approval: ApprovalRequest;
  options: RuntimePermissionOption[];
}

interface ContextUsage {
  used: number;
  size: number;
}

export class DshAgentSession {
  readonly #store: SessionStore;
  readonly #session: SessionSummary;
  readonly #runtime: RuntimeAdapter;
  readonly #emit: (envelope: TimelineEnvelope) => void;
  readonly #availableRuntimes: RuntimeKind[];
  readonly #buffer: RunMessageBuffer;
  #projectedSeq: number;
  readonly #unsubscribe: () => void;
  readonly #pending = new Map<string, PendingPermission>();
  readonly #tools = new Set<string>();
  #activeRunId: string | null = null;
  #assistantOpen = false;
  #assistantMessageId: string | null = null;
  #assistantText = "";
  #assistantReasoning = "";
  #assistantToolCalls: Array<{
    toolCallId: string;
    name: string;
    input: Record<string, unknown>;
  }> = [];
  #approvalMode: ApprovalMode;
  #contextUsage: ContextUsage | undefined;
  #runTurn = 0;
  #changes: ChangeTracker | null = null;
  #workspaceRoot: string;

  private constructor(options: {
    store: SessionStore;
    session: SessionSummary;
    runtime: RuntimeAdapter;
    emit: (envelope: TimelineEnvelope) => void;
    availableRuntimes: RuntimeKind[];
    buffer: RunMessageBuffer;
  }) {
    this.#store = options.store;
    this.#session = options.session;
    this.#runtime = options.runtime;
    this.#emit = options.emit;
    this.#availableRuntimes = options.availableRuntimes;
    this.#buffer = options.buffer;
    this.#projectedSeq = projectTimelineSnapshot(
      options.session.id,
      options.store.loadSessionEvents(options.session.id),
    ).lastSeq;
    this.#approvalMode = options.session.approvalMode;
    this.#workspaceRoot = options.session.workspace.root;
    this.#unsubscribe = this.#runtime.subscribe(async (event) => {
      await this.#handleRuntimeEvent(event);
    });
  }

  static async open(options: {
    store: SessionStore;
    session: SessionSummary;
    runtime: RuntimeAdapter;
    emit: (envelope: TimelineEnvelope) => void;
    availableRuntimes: RuntimeKind[];
    buffer: RunMessageBuffer;
  }): Promise<DshAgentSession> {
    const instance = new DshAgentSession(options);
    try {
      const workspace = await Workspace.open(options.session.workspace.root);
      instance.#changes = new ChangeTracker(workspace);
      instance.#changes.hydrateBaselines(
        options.store.loadBaselines(options.session.id),
      );
    } catch {
      instance.#changes = null;
    }
    const externalSessionId = options.store.getRuntimeSessionId(
      options.session.id,
    );
    const events = options.store.loadSessionEvents(options.session.id);
    const messages = projectCanonicalMessages(events);
    const watermark =
      options.store.getRuntimeSession(options.session.id, "dsh")
        ?.lastSyncedCanonicalSeq ?? 0;
    const importOptions = {
      workspaceRoot: options.session.workspace.root,
      provider: "deepseek",
      model: "deepseek-v4-pro",
    };

    if (!externalSessionId) {
      if (messages.length > 0 && options.runtime.importSession) {
        const importedId = randomUUID();
        await options.runtime.importSession({
          sessionId: importedId,
          ...importOptions,
          canonicalMessages: messages,
        });
        options.store.setRuntimeImport(
          options.session.id,
          importedId,
          events.at(-1)?.seq ?? 0,
        );
        await options.runtime.resumeSession({
          sessionId: options.session.id,
          workspaceRoot: options.session.workspace.root,
          externalSessionId: importedId,
        });
        return instance;
      }
      const handle = await options.runtime.createSession({
        sessionId: options.session.id,
        workspaceRoot: options.session.workspace.root,
      });
      options.store.setRuntimeSessionId(
        options.session.id,
        handle.externalSessionId,
      );
      return instance;
    }

    // Existing DSH session: append the canonical delta past the watermark.
    if (options.runtime.importSession && watermark > 0) {
      const syncedMessages = projectCanonicalMessages(
        events.filter((envelope) => envelope.seq <= watermark),
      );
      if (messages.length > syncedMessages.length) {
        const delta = messages.slice(syncedMessages.length);
        const startTurn =
          syncedMessages.filter((message) => message.role === "user").length +
          1;
        await options.runtime.importSession({
          sessionId: externalSessionId,
          appendToExternalSessionId: externalSessionId,
          startTurn,
          ...importOptions,
          canonicalMessages: delta,
        });
        options.store.setRuntimeImport(
          options.session.id,
          externalSessionId,
          events.at(-1)?.seq ?? 0,
        );
        await options.runtime.resumeSession({
          sessionId: options.session.id,
          workspaceRoot: options.session.workspace.root,
          externalSessionId,
        });
        return instance;
      }
    }

    await options.runtime.resumeSession({
      sessionId: options.session.id,
      workspaceRoot: options.session.workspace.root,
      externalSessionId,
    });
    return instance;
  }

  get sessionId(): string {
    return this.#session.id;
  }

  get status(): AgentStatus {
    return {
      sessionId: this.#session.id,
      runtimeKind: "dsh",
      availableRuntimes: this.#availableRuntimes,
      provider: "deepseek",
      model: "deepseek-v4-pro",
      configured: Boolean(process.env["DEEPSEEK_API_KEY"]?.trim()),
      approvalMode: this.#approvalMode,
      workspace: this.#session.workspace,
    };
  }

  snapshot(): TimelineSnapshot {
    return projectTimelineSnapshot(
      this.#session.id,
      this.#store.loadSessionEvents(this.#session.id),
    );
  }

  startPrompt(runId: string, prompt: string): void {
    if (this.#activeRunId) throw new Error("DSH is already running");
    this.#activeRunId = runId;
    this.#assistantOpen = false;
    this.#assistantMessageId = null;
    this.#assistantText = "";
    this.#assistantReasoning = "";
    this.#assistantToolCalls = [];
    this.#contextUsage = undefined;
    this.#runTurn = 0;
    this.#store.setLifecycle(this.#session.id, "running", runId);
    const userMessage: CanonicalMessage = {
      id: `${runId}:user`,
      role: "user",
      content: [{ type: "text", text: prompt }],
      sourceRuntime: "dsh",
      createdAt: Date.now(),
    };
    this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "dsh",
      runId,
      messageId: userMessage.id,
      idempotencyKey: `run:${runId}:start`,
      event: { kind: "run.started", userMessage },
    });
    this.#publish(runId, {
      type: "run_start",
      userItemId: `${runId}:user`,
      prompt,
    });
    void this.#runtime
      .send(this.#session.id, runId, prompt)
      .catch(() => {})
      .finally(() => {
        if (this.#activeRunId === runId) this.#activeRunId = null;
      });
  }

  async cancel(runId: string): Promise<boolean> {
    if (this.#activeRunId !== runId) return false;
    await this.#runtime.cancel(this.#session.id);
    return true;
  }

  async resolveApproval(
    callId: string,
    decision: { approved: boolean; effectDigest: string },
  ): Promise<boolean> {
    const pending = this.#pending.get(callId);
    if (
      !pending ||
      pending.approval.effectDigest !== decision.effectDigest
    ) {
      return false;
    }
    const option = pending.options.find((candidate) =>
      decision.approved
        ? candidate.kind === "allow_once" ||
          candidate.kind === "allow_always"
        : candidate.kind === "reject_once" ||
          candidate.kind === "reject_always",
    );
    this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "dsh",
      runId: pending.runId,
      turnId: pending.turnId,
      toolCallId: callId,
      idempotencyKey: `approval:${callId}:resolved`,
      event: {
        kind: "approval.resolved",
        toolItemId: callId,
        callId,
        approved: decision.approved,
      },
    });
    this.#publish(pending.runId, {
      type: "approval_resolved",
      turnId: pending.turnId,
      itemId: `${callId}:approval`,
      toolItemId: callId,
      callId,
      approved: decision.approved,
    });
    this.#pending.delete(callId);
    return this.#runtime.resolvePermission({
      permissionId: pending.runtimePermissionId,
      ...(option ? { optionId: option.optionId } : { cancelled: true }),
    });
  }

  changedFiles(): Promise<ChangedFile[]> {
    return this.#changes?.changedFiles() ?? Promise.resolve([]);
  }

  diff(userPath: string): Promise<FileDiff | undefined> {
    return this.#changes?.diff(userPath) ?? Promise.resolve(undefined);
  }

  setApprovalMode(mode: ApprovalMode): SessionSummary {
    this.#approvalMode = mode;
    return this.#store.setApprovalMode(this.#session.id, mode);
  }

  async dispose(): Promise<void> {
    this.#unsubscribe();
    await this.#runtime.closeSession(this.#session.id).catch(() => {});
    this.#activeRunId = null;
  }

  #publish(runId: string, event: TimelineEvent): void {
    this.#store.appendTimeline(
      this.#session.id,
      runId,
      event,
    );
    const projected = this.snapshot();
    for (const next of projected.events.slice(this.#projectedSeq)) {
      this.#emit(next);
    }
    this.#projectedSeq = projected.lastSeq;
  }

  #turnIdFor(runId: string, messageId?: string): string {
    return messageId ?? `${runId}:assistant`;
  }

  #ensureAssistant(runId: string, messageId?: string): string {
    const turnId = this.#turnIdFor(runId, messageId);
    if (this.#assistantOpen && this.#assistantMessageId !== turnId) {
      this.#closeAssistant(runId);
    }
    if (!this.#assistantOpen) {
      this.#runTurn += 1;
      const turn = this.#runTurn;
      this.#assistantOpen = true;
      this.#assistantMessageId = turnId;
      this.#assistantText = "";
      this.#assistantReasoning = "";
      this.#assistantToolCalls = [];
      this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "dsh",
        runId,
        turnId,
        idempotencyKey: `turn:${turnId}:start`,
        event: { kind: "turn.started", turn },
      });
      this.#publish(runId, { type: "turn_start", turnId, turn });
      this.#publish(runId, {
        type: "assistant_start",
        turnId,
        itemId: turnId,
      });
    }
    return turnId;
  }

  #closeAssistant(runId: string, stopReason?: string): void {
    if (!this.#assistantOpen || !this.#assistantMessageId) return;
    const turnId = this.#assistantMessageId;
    const effectiveStop =
      stopReason ??
      (this.#assistantToolCalls.length > 0 ? "toolUse" : "stop");
    const message: CanonicalMessage = {
      id: turnId,
      role: "assistant",
      content: [
        ...(this.#assistantReasoning
          ? [{
              type: "reasoning" as const,
              text: this.#assistantReasoning,
              signature: "reasoning_content",
            }]
          : []),
        ...(this.#assistantText
          ? [{ type: "text" as const, text: this.#assistantText }]
          : []),
        ...this.#assistantToolCalls.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.toolCallId,
          name: call.name,
          input: call.input,
        })),
      ],
      sourceRuntime: "dsh",
      createdAt: Date.now(),
    };
    this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "dsh",
      runId,
      turnId,
      messageId: turnId,
      idempotencyKey: `assistant:${turnId}`,
      event: {
        kind: "message.assistant.committed",
        message,
        stopReason: effectiveStop,
        usage: { input: 0, output: 0, totalTokens: 0, cost: 0 },
        ...(this.#contextUsage ? { contextUsage: this.#contextUsage } : {}),
      },
    });
    this.#buffer.commitMessage(this.#session.id, runId, turnId);
    this.#publish(runId, {
      type: "assistant_end",
      turnId,
      itemId: turnId,
      stopReason: effectiveStop,
      ...(this.#contextUsage ? { contextUsage: this.#contextUsage } : {}),
    });
    this.#assistantOpen = false;
    this.#assistantMessageId = null;
    this.#assistantText = "";
    this.#assistantReasoning = "";
    this.#assistantToolCalls = [];
  }

  #recordContextUsage(runId: string, usage: ContextUsage): void {
    this.#contextUsage = usage;
    this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "dsh",
      runId,
      idempotencyKey: `run:${runId}:context-usage:${usage.used}:${usage.size}`,
      event: {
        kind: "usage.recorded",
        usage: { input: 0, output: 0, totalTokens: 0, cost: 0 },
        contextUsage: usage,
      },
    });
  }

  async #handleRuntimeEvent(event: RuntimeEvent): Promise<void> {
    if (event.sessionId && event.sessionId !== this.#session.id) return;
    if (event.type === "runtime_error") {
      if (this.#activeRunId) {
        this.#store.appendSessionEvent({
          sessionId: this.#session.id,
          runtimeKind: "dsh",
          runId: this.#activeRunId,
          idempotencyKey: `run:${this.#activeRunId}:end`,
          event: { kind: "run.ended", status: "crashed" },
        });
        this.#publish(this.#activeRunId, {
          type: "run_end",
          status: "crashed",
        });
        this.#store.setLifecycle(this.#session.id, "crashed");
        this.#buffer.endRun(this.#session.id, this.#activeRunId);
      }
      return;
    }
    const runId = "runId" in event ? event.runId : this.#activeRunId;
    if (!runId || runId !== this.#activeRunId) return;
    if (event.type === "run_start") return;
    if (event.type === "assistant_thought") {
      const turnId = this.#ensureAssistant(runId, event.messageId);
      this.#assistantReasoning += event.delta;
      this.#buffer.ingest({
        sessionId: this.#session.id,
        runId,
        turnId,
        messageId: turnId,
        emittedAt: Date.now(),
        frame: { kind: "assistant.reasoning.delta", delta: event.delta },
      });
    } else if (event.type === "assistant_text") {
      const turnId = this.#ensureAssistant(runId, event.messageId);
      this.#assistantText += event.delta;
      this.#buffer.ingest({
        sessionId: this.#session.id,
        runId,
        turnId,
        messageId: turnId,
        emittedAt: Date.now(),
        frame: { kind: "assistant.text.delta", delta: event.delta },
      });
    } else if (event.type === "context_usage") {
      this.#recordContextUsage(runId, {
        used: event.used,
        size: event.size,
      });
    } else if (event.type === "tool") {
      const turnId = this.#assistantMessageId ?? `${runId}:exec`;
      const arguments_ =
        typeof event.input === "object" && event.input !== null
          ? (event.input as Record<string, unknown>)
          : {};
      if (!this.#tools.has(event.callId)) {
        this.#tools.add(event.callId);
        this.#assistantToolCalls.push({
          toolCallId: event.callId,
          name: event.title,
          input: arguments_,
        });
        this.#ensureAssistant(runId, turnId);
        this.#store.appendSessionEvent({
          sessionId: this.#session.id,
          runtimeKind: "dsh",
          runId,
          turnId,
          toolCallId: event.callId,
          idempotencyKey: `tool:${event.callId}:call`,
          event: {
            kind: "tool.call.committed",
            toolCall: {
              id: event.callId,
              name: event.title,
              input: arguments_,
            },
          },
        });
        this.#publish(runId, {
          type: "tool_requested",
          turnId,
          itemId: event.callId,
          callId: event.callId,
          tool: event.title,
          arguments: arguments_,
        });
      }
      if (event.status === "running") {
        await this.#captureToolFile(event.title, arguments_, event.kind);
        this.#store.appendSessionEvent({
          sessionId: this.#session.id,
          runtimeKind: "dsh",
          runId,
          turnId,
          toolCallId: event.callId,
          idempotencyKey: `tool:${event.callId}:start`,
          event: {
            kind: "tool.execution.started",
            toolCallId: event.callId,
          },
        });
        this.#publish(runId, {
          type: "tool_start",
          turnId,
          itemId: event.callId,
          callId: event.callId,
          tool: event.title,
          arguments: arguments_,
        });
      } else {
        this.#store.appendSessionEvent({
          sessionId: this.#session.id,
          runtimeKind: "dsh",
          runId,
          turnId,
          messageId: `tool:${event.callId}`,
          toolCallId: event.callId,
          idempotencyKey: `tool:${event.callId}:result`,
          event: {
            kind: "tool.result.committed",
            result: {
              toolCallId: event.callId,
              content: event.output ?? "",
              isError: event.status === "failed",
              rawPayload: { dsh: event },
            },
          },
        });
        this.#publish(runId, {
          type: "tool_end",
          turnId,
          itemId: event.callId,
          callId: event.callId,
          tool: event.title,
          isError: event.status === "failed",
          output: event.output ?? "",
        });
        if (event.status !== "failed") {
          await this.#emitToolChanges(
            runId,
            turnId,
            event.callId,
            event.title,
            arguments_,
            event.kind,
          );
        }
      }
    } else if (event.type === "permission") {
      await this.#handlePermission(event);
    } else if (event.type === "run_end") {
      this.#closeAssistant(runId, event.status === "completed" ? "stop" : event.status);
      this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "dsh",
        runId,
        idempotencyKey: `run:${runId}:end`,
        event: { kind: "run.ended", status: event.status },
      });
      this.#publish(runId, { type: "run_end", status: event.status });
      this.#store.setLifecycle(this.#session.id, "idle");
      this.#buffer.endRun(this.#session.id, runId);
    }
  }

  async #captureToolFile(
    title: string,
    input: Record<string, unknown>,
    toolKind?: string,
  ): Promise<void> {
    if (!this.#changes || !isFileAffectingDshTool(title, toolKind)) return;
    const userPath = resolveToolWorkspacePath(input, this.#workspaceRoot);
    if (!userPath) return;
    try {
      await this.#changes.capture(userPath);
    } catch {
      /* 路径无效或文件不可读时跳过，避免阻断 tool 流程 */
    }
  }

  async #emitToolChanges(
    runId: string,
    turnId: string,
    callId: string,
    title: string,
    input: Record<string, unknown>,
    toolKind?: string,
  ): Promise<void> {
    if (!this.#changes || !isFileAffectingDshTool(title, toolKind)) return;
    const userPath = resolveToolWorkspacePath(input, this.#workspaceRoot);
    if (userPath) {
      try {
        await this.#changes.capture(userPath);
      } catch {
        /* ignore */
      }
    }
    let files;
    try {
      files = await Promise.all(
        (await this.#changes.changedFiles()).map(async (file) => {
          if (file.binary || file.sensitive || file.tooLarge) return file;
          const diff = await this.#changes!.diff(file.path);
          return diff ? { ...file, ...diffLineStats(diff.patch) } : file;
        }),
      );
    } catch {
      return;
    }
    if (files.length === 0) return;
    for (const baseline of this.#changes.exportBaselines()) {
      this.#store.saveBaseline(this.#session.id, baseline);
    }
    this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "dsh",
      runId,
      turnId,
      toolCallId: callId,
      idempotencyKey: `changes:${callId}`,
      event: {
        kind: "changes.committed",
        callId,
        files,
      },
    });
    this.#publish(runId, {
      type: "changes",
      turnId,
      itemId: `${callId}:changes`,
      callId,
      files,
    });
  }

  async #handlePermission(
    event: Extract<RuntimeEvent, { type: "permission" }>,
  ): Promise<void> {
    const mode = this.#approvalMode;
    const input =
      typeof event.input === "object" && event.input !== null
        ? (event.input as Record<string, unknown>)
        : {};
    const turnId = this.#assistantMessageId ?? `${event.runId}:exec`;
    if (!this.#tools.has(event.callId)) {
      this.#tools.add(event.callId);
      this.#assistantToolCalls.push({
        toolCallId: event.callId,
        name: event.title,
        input,
      });
      this.#ensureAssistant(event.runId, turnId);
      this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "dsh",
        runId: event.runId,
        turnId,
        toolCallId: event.callId,
        idempotencyKey: `tool:${event.callId}:call`,
        event: {
          kind: "tool.call.committed",
          toolCall: {
            id: event.callId,
            name: event.title,
            input,
          },
        },
      });
      this.#publish(event.runId, {
        type: "tool_requested",
        turnId,
        itemId: event.callId,
        callId: event.callId,
        tool: event.title,
        arguments: input,
      });
    }
    const evaluation = evaluateDshApproval(
      {
        callId: event.callId,
        title: event.title,
        ...(event.toolKind ? { toolKind: event.toolKind } : {}),
        input,
      },
      mode,
      this.#session.workspace.root,
    );
    const allowOption = event.options.find(
      (option) =>
        option.kind === "allow_once" || option.kind === "allow_always",
    );
    if (!evaluation.reason && allowOption) {
      await this.#runtime.resolvePermission({
        permissionId: event.permissionId,
        optionId: allowOption.optionId,
      });
      return;
    }

    const approval: ApprovalRequest = {
      callId: event.callId,
      tool: event.title,
      arguments: input,
      effect: { ...evaluation.effect },
      effectDigest: evaluation.effectDigest,
      reason:
        evaluation.reason ?? "DSH permission requires an explicit decision",
    };
    this.#pending.set(event.callId, {
      runId: event.runId,
      turnId,
      runtimePermissionId: event.permissionId,
      approval,
      options: event.options,
    });
    this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "dsh",
      runId: event.runId,
      turnId,
      toolCallId: event.callId,
      idempotencyKey: `approval:${event.callId}:requested`,
      event: {
        kind: "approval.requested",
        toolItemId: event.callId,
        approval,
      },
    });
    this.#publish(event.runId, {
      type: "approval_requested",
      turnId,
      itemId: `${event.callId}:approval`,
      toolItemId: event.callId,
      approval,
    });
    this.#store.setLifecycle(
      this.#session.id,
      "awaiting_approval",
      event.runId,
    );
  }
}
