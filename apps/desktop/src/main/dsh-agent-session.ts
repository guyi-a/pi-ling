import { createHash } from "node:crypto";

import { classifyCommand } from "@pi-ling/coding-agent";
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimePermissionOption,
} from "@pi-ling/runtime-contracts";
import type {
  AgentStatus,
  AgentUsage,
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
import { projectTimelineSnapshot } from "@pi-ling/session-events";

import { RunMessageBuffer } from "./run-message-buffer.js";
import { SessionStore } from "./session-store/session-store.js";

interface PendingPermission {
  runId: string;
  turnId: string;
  runtimePermissionId: string;
  approval: ApprovalRequest;
  options: RuntimePermissionOption[];
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
  readonly #toolTurns = new Map<string, string>();
  #activeRunId: string | null = null;
  #turn = 0;
  #assistantOpen = false;
  #assistantHasText = false;
  #assistantText = "";
  #assistantReasoning = "";
  #approvalMode: ApprovalMode;
  #usage: AgentUsage = {
    input: 0,
    output: 0,
    totalTokens: 0,
    cost: 0,
  };

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
    this.#unsubscribe = this.#runtime.subscribe((event) =>
      this.#handleRuntimeEvent(event),
    );
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
    const externalSessionId = options.store.getRuntimeSessionId(
      options.session.id,
    );
    const handle = externalSessionId
      ? await options.runtime.resumeSession({
          sessionId: options.session.id,
          workspaceRoot: options.session.workspace.root,
          externalSessionId,
        })
      : await options.runtime.createSession({
          sessionId: options.session.id,
          workspaceRoot: options.session.workspace.root,
        });
    options.store.setRuntimeSessionId(
      options.session.id,
      handle.externalSessionId,
    );
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
      model: "deepseek-v4-flash",
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
    this.#turn = 0;
    this.#assistantOpen = false;
    this.#assistantHasText = false;
    this.#assistantText = "";
    this.#assistantReasoning = "";
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
    return Promise.resolve([]);
  }

  diff(_path: string): Promise<FileDiff | undefined> {
    return Promise.resolve(undefined);
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

  #turnId(): string {
    return `${this.#activeRunId}:turn:${Math.max(1, this.#turn)}`;
  }

  #ensureAssistant(runId: string): string {
    if (!this.#assistantOpen) {
      this.#turn += 1;
      this.#assistantOpen = true;
      this.#assistantHasText = false;
      this.#assistantText = "";
      this.#assistantReasoning = "";
      const turnId = this.#turnId();
      this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "dsh",
        runId,
        turnId,
        idempotencyKey: `turn:${turnId}:start`,
        event: { kind: "turn.started", turn: this.#turn },
      });
      this.#publish(runId, { type: "turn_start", turnId, turn: this.#turn });
      this.#publish(runId, {
        type: "assistant_start",
        turnId,
        itemId: `${turnId}:assistant`,
      });
    }
    return this.#turnId();
  }

  #closeAssistant(runId: string, stopReason: string): void {
    if (!this.#assistantOpen) return;
    const turnId = this.#turnId();
    const messageId = `${turnId}:assistant`;
    const message: CanonicalMessage = {
      id: messageId,
      role: "assistant",
      content: [
        ...(this.#assistantReasoning
          ? [{ type: "reasoning" as const, text: this.#assistantReasoning }]
          : []),
        ...(this.#assistantText
          ? [{ type: "text" as const, text: this.#assistantText }]
          : []),
      ],
      sourceRuntime: "dsh",
      createdAt: Date.now(),
    };
    this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "dsh",
      runId,
      turnId,
      messageId,
      idempotencyKey: `assistant:${turnId}`,
      event: {
        kind: "message.assistant.committed",
        message,
        stopReason,
        usage: this.#usage,
      },
    });
    this.#buffer.commitMessage(this.#session.id, runId, messageId);
    this.#publish(runId, {
      type: "assistant_end",
      turnId,
      itemId: messageId,
      stopReason,
      usage: this.#usage,
    });
    this.#assistantOpen = false;
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
      const turnId = this.#ensureAssistant(runId);
      this.#assistantReasoning += event.delta;
      this.#buffer.ingest({
        sessionId: this.#session.id,
        runId,
        turnId,
        messageId: `${turnId}:assistant`,
        emittedAt: Date.now(),
        frame: { kind: "assistant.reasoning.delta", delta: event.delta },
      });
    } else if (event.type === "assistant_text") {
      const turnId = this.#ensureAssistant(runId);
      this.#assistantHasText = true;
      this.#assistantText += event.delta;
      this.#buffer.ingest({
        sessionId: this.#session.id,
        runId,
        turnId,
        messageId: `${turnId}:assistant`,
        emittedAt: Date.now(),
        frame: { kind: "assistant.text.delta", delta: event.delta },
      });
    } else if (event.type === "usage") {
      this.#usage = {
        input: event.used,
        output: 0,
        totalTokens: event.used,
        cost: 0,
      };
    } else if (event.type === "tool") {
      let turnId = this.#toolTurns.get(event.callId);
      if (!turnId) {
        turnId = this.#ensureAssistant(runId);
        this.#toolTurns.set(event.callId, turnId);
      }
      const arguments_ =
        typeof event.input === "object" && event.input !== null
          ? (event.input as Record<string, unknown>)
          : {};
      if (!this.#tools.has(event.callId)) {
        this.#tools.add(event.callId);
        this.#closeAssistant(runId, "toolUse");
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
        this.#closeAssistant(runId, "toolUse");
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

  async #handlePermission(
    event: Extract<RuntimeEvent, { type: "permission" }>,
  ): Promise<void> {
    const mode = this.#approvalMode;
    const input =
      typeof event.input === "object" && event.input !== null
        ? (event.input as Record<string, unknown>)
        : {};
    if (!this.#tools.has(event.callId)) {
      const turnId = this.#ensureAssistant(event.runId);
      this.#tools.add(event.callId);
      this.#toolTurns.set(event.callId, turnId);
      this.#closeAssistant(event.runId, "toolUse");
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
    const command =
      typeof input["command"] === "string" ? input["command"] : "";
    const destructive =
      event.toolKind === "delete" ||
      event.toolKind === "other" ||
      (event.toolKind === "execute" &&
        classifyCommand(command) === "destructive");
    const autoAllow =
      !destructive &&
      (event.toolKind === "read" ||
        event.toolKind === "search" ||
        (mode === "accept-write" && event.toolKind === "edit") ||
        mode === "auto");
    const allowOption = event.options.find(
      (option) =>
        option.kind === "allow_once" || option.kind === "allow_always",
    );
    if (autoAllow && allowOption) {
      await this.#runtime.resolvePermission({
        permissionId: event.permissionId,
        optionId: allowOption.optionId,
      });
      return;
    }

    const digest = createHash("sha256")
      .update(JSON.stringify(event))
      .digest("hex");
    const approval: ApprovalRequest = {
      callId: event.callId,
      tool: event.title,
      arguments: input,
      effect: {
        kind: `dsh-${event.toolKind ?? "unknown"}`,
        title: event.title,
      },
      effectDigest: digest,
      reason: `DSH requests ${event.toolKind ?? "unknown"} permission`,
    };
    this.#pending.set(event.callId, {
      runId: event.runId,
      turnId: this.#turnId(),
      runtimePermissionId: event.permissionId,
      approval,
      options: event.options,
    });
    const turnId = this.#toolTurns.get(event.callId) ?? this.#turnId();
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
