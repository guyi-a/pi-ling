import {
  CodingAgent,
  type ApprovalDecision,
  type ApprovalRequest as RuntimeApprovalRequest,
  type CodingAgentEvent,
  type FileBaseline,
} from "@pi-ling/coding-agent";
import { createModels, type Message, type ToolCall } from "@pi-ling/ai";
import { deepseekProvider } from "@pi-ling/ai/providers/deepseek";
import type {
  AgentStatus,
  AgentUsage,
  ChangedFile,
  FileDiff,
  SessionSummary,
  RuntimeKind,
  TimelineEnvelope,
  TimelineEvent,
  TimelineSnapshot,
} from "@pi-ling/contracts";

import {
  SessionStore,
  type RunCheckpoint,
} from "./session-store/session-store.js";

const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-flash";
const models = createModels([deepseekProvider()]);

function turnNumber(turnId: string): number {
  const value = Number(turnId.match(/:turn:(\d+)$/)?.[1]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export class PiAgentSession {
  readonly #store: SessionStore;
  readonly #session: SessionSummary;
  readonly #emit: (envelope: TimelineEnvelope) => void;
  readonly #agent: CodingAgent;
  readonly #availableRuntimes: RuntimeKind[];
  #activeRunId: string | null = null;
  #runOutcome: "completed" | "cancelled" | "error" = "completed";

  private constructor(
    store: SessionStore,
    session: SessionSummary,
    emit: (envelope: TimelineEnvelope) => void,
    agent: CodingAgent,
    availableRuntimes: RuntimeKind[],
  ) {
    this.#store = store;
    this.#session = session;
    this.#emit = emit;
    this.#agent = agent;
    this.#availableRuntimes = availableRuntimes;
  }

  static async open(options: {
    store: SessionStore;
    session: SessionSummary;
    emit: (envelope: TimelineEnvelope) => void;
    availableRuntimes?: RuntimeKind[];
  }): Promise<PiAgentSession> {
    const model = models.getModel(PROVIDER, MODEL);
    if (!model) {
      throw new Error(`Model is unavailable: ${PROVIDER}/${MODEL}`);
    }
    const checkpoint = options.store.getActiveCheckpoint(options.session.id);
    const pending = options.store.loadPendingApprovals(options.session.id);
    const approved =
      checkpoint?.phase === "approved_pending_exec" &&
      checkpoint.pendingApproval
        ? [checkpoint.pendingApproval]
        : [];
    let instance!: PiAgentSession;
    const agent = await CodingAgent.create({
      workspaceRoot: options.session.workspace.root,
      model,
      streamFn: models.stream.bind(models),
      messages: options.store.loadMessages(options.session.id),
      baselines: options.store.loadBaselines(
        options.session.id,
      ) as FileBaseline[],
      pendingApprovals:
        checkpoint?.phase === "awaiting_approval" ? pending : [],
      approvedApprovals: approved,
      approvalMode: options.session.approvalMode,
      emit: (event) => instance.#handleCodingEvent(event),
    });
    instance = new PiAgentSession(
      options.store,
      options.session,
      options.emit,
      agent,
      options.availableRuntimes ?? ["native"],
    );
    instance.#recover(checkpoint);
    return instance;
  }

  get sessionId(): string {
    return this.#session.id;
  }

  get status(): AgentStatus {
    return {
      sessionId: this.#session.id,
      runtimeKind: "native",
      availableRuntimes: this.#availableRuntimes,
      provider: PROVIDER,
      model: MODEL,
      configured: Boolean(process.env["DEEPSEEK_API_KEY"]?.trim()),
      approvalMode: this.#agent.approvalMode,
      workspace: this.#session.workspace,
    };
  }

  snapshot(): TimelineSnapshot {
    return this.#store.loadSnapshot(this.#session.id);
  }

  startPrompt(runId: string, prompt: string): void {
    if (this.#activeRunId || this.#agent.isStreaming) {
      throw new Error("Agent is already processing a prompt");
    }
    this.#activeRunId = runId;
    this.#runOutcome = "completed";
    this.#store.setLifecycle(this.#session.id, "running", runId);
    this.#store.setCheckpoint({
      sessionId: this.#session.id,
      runId,
      phase: "started",
      updatedAt: Date.now(),
    });
    this.#publish(runId, {
      type: "run_start",
      userItemId: `${runId}:user`,
      prompt,
    });
    void this.#agent
      .prompt(prompt, runId)
      .catch((error: unknown) => this.#failRun(runId, error))
      .finally(() => {
        if (this.#activeRunId === runId) {
          this.#activeRunId = null;
        }
      });
  }

  cancel(runId: string): boolean {
    if (this.#activeRunId !== runId) {
      return false;
    }
    this.#runOutcome = "cancelled";
    this.#agent.cancel();
    return true;
  }

  async resolveApproval(
    callId: string,
    decision: ApprovalDecision,
  ): Promise<boolean> {
    return this.#agent.resolveApproval(callId, decision);
  }

  changedFiles(): Promise<ChangedFile[]> {
    return this.#agent.changedFiles();
  }

  waitForIdle(): Promise<void> {
    return this.#agent.waitForIdle();
  }

  setApprovalMode(
    mode: SessionSummary["approvalMode"],
  ): SessionSummary {
    const session = this.#store.setApprovalMode(this.#session.id, mode);
    this.#agent.setApprovalMode(mode);
    return session;
  }

  diff(userPath: string): Promise<FileDiff | undefined> {
    return this.#agent.diff(userPath);
  }

  async dispose(): Promise<void> {
    this.#agent.cancel();
    await this.#agent.waitForIdle();
    this.#activeRunId = null;
  }

  #publish(runId: string, event: TimelineEvent): TimelineEnvelope {
    const envelope = this.#store.appendTimeline(
      this.#session.id,
      runId,
      event,
    );
    this.#emit(envelope);
    return envelope;
  }

  #persistMessage(
    runId: string,
    turnId: string | undefined,
    message: Message,
  ): void {
    const eventKey =
      message.role === "user"
        ? `user:${runId}`
        : message.role === "assistant"
          ? `assistant:${turnId ?? runId}`
          : `tool:${message.toolCallId}`;
    this.#store.appendMessage({
      sessionId: this.#session.id,
      eventKey,
      runId,
      ...(turnId ? { turnId } : {}),
      message,
    });
  }

  async #handleCodingEvent(event: CodingAgentEvent): Promise<void> {
    if (event.type === "approval_requested") {
      const approval = event.approval;
      const pendingTool: ToolCall = {
        type: "toolCall",
        id: approval.callId,
        name: approval.tool,
        arguments: approval.arguments,
      };
      this.#store.savePendingApproval(this.#session.id, approval);
      this.#store.setCheckpoint({
        sessionId: this.#session.id,
        runId: approval.runId,
        phase: "awaiting_approval",
        turnId: approval.turnId,
        pendingCallId: approval.callId,
        pendingTool,
        pendingApproval: approval,
        updatedAt: Date.now(),
      });
      this.#store.setLifecycle(
        this.#session.id,
        "awaiting_approval",
        approval.runId,
      );
      this.#publish(approval.runId, {
        type: "approval_requested",
        turnId: approval.turnId,
        itemId: `${approval.callId}:approval`,
        toolItemId: approval.callId,
        approval: {
          callId: approval.callId,
          tool: approval.tool,
          arguments: approval.arguments,
          effect: { ...approval.effect },
          effectDigest: approval.effectDigest,
          reason: approval.reason,
        },
      });
      return;
    }
    if (event.type === "approval_resolved") {
      const checkpoint = this.#store.getCheckpoint(
        this.#session.id,
        event.runId,
      );
      this.#store.setCheckpoint({
        sessionId: this.#session.id,
        runId: event.runId,
        phase: event.approved ? "approved_pending_exec" : "between_turns",
        turnId: event.turnId,
        pendingCallId: event.callId,
        ...(checkpoint?.pendingTool
          ? { pendingTool: checkpoint.pendingTool }
          : {}),
        ...(checkpoint?.pendingApproval
          ? { pendingApproval: checkpoint.pendingApproval }
          : {}),
        updatedAt: Date.now(),
      });
      this.#store.deletePendingApproval(this.#session.id, event.callId);
      this.#store.setLifecycle(this.#session.id, "running", event.runId);
      this.#publish(event.runId, {
        type: "approval_resolved",
        turnId: event.turnId,
        itemId: `${event.callId}:approval`,
        toolItemId: event.callId,
        callId: event.callId,
        approved: event.approved,
      });
      return;
    }
    if (event.type === "changes") {
      for (const baseline of this.#agent.baselines()) {
        this.#store.saveBaseline(this.#session.id, baseline);
      }
      this.#publish(event.runId, {
        type: "changes",
        turnId: event.turnId,
        itemId: `${event.callId}:changes`,
        callId: event.callId,
        files: event.files,
      });
      return;
    }

    const agentEvent = event.event;
    const runId = agentEvent.runId;
    switch (agentEvent.type) {
      case "agent_start":
        break;
      case "turn_start":
        this.#store.setCheckpoint({
          sessionId: this.#session.id,
          runId,
          phase: "streaming",
          turnId: agentEvent.turnId,
          updatedAt: Date.now(),
        });
        this.#publish(runId, {
          type: "turn_start",
          turnId: agentEvent.turnId,
          turn: agentEvent.turn,
        });
        break;
      case "turn_end":
        this.#store.setCheckpoint({
          sessionId: this.#session.id,
          runId,
          phase: "between_turns",
          turnId: agentEvent.turnId,
          updatedAt: Date.now(),
        });
        this.#publish(runId, {
          type: "turn_end",
          turnId: agentEvent.turnId,
        });
        break;
      case "message_start":
        if (
          agentEvent.message.role === "assistant" &&
          agentEvent.turnId
        ) {
          this.#publish(runId, {
            type: "assistant_start",
            turnId: agentEvent.turnId,
            itemId: `${agentEvent.turnId}:assistant`,
          });
        }
        break;
      case "message_update":
        if (agentEvent.assistantMessageEvent.type === "text_delta") {
          this.#publish(runId, {
            type: "assistant_text_delta",
            turnId: agentEvent.turnId,
            itemId: `${agentEvent.turnId}:assistant`,
            delta: agentEvent.assistantMessageEvent.delta,
          });
        } else if (
          agentEvent.assistantMessageEvent.type === "thinking_delta"
        ) {
          this.#publish(runId, {
            type: "assistant_thinking_delta",
            turnId: agentEvent.turnId,
            itemId: `${agentEvent.turnId}:assistant`,
            delta: agentEvent.assistantMessageEvent.delta,
          });
        }
        break;
      case "message_end":
        this.#persistMessage(
          runId,
          agentEvent.turnId,
          agentEvent.message,
        );
        if (
          agentEvent.message.role === "assistant" &&
          agentEvent.turnId
        ) {
          const usage: AgentUsage = {
            input: agentEvent.message.usage.input,
            output: agentEvent.message.usage.output,
            totalTokens: agentEvent.message.usage.totalTokens,
            cost: agentEvent.message.usage.cost.total,
          };
          if (agentEvent.message.usage.reasoning !== undefined) {
            usage.reasoning = agentEvent.message.usage.reasoning;
          }
          this.#publish(runId, {
            type: "assistant_end",
            turnId: agentEvent.turnId,
            itemId: `${agentEvent.turnId}:assistant`,
            stopReason: agentEvent.message.stopReason,
            usage,
            ...(agentEvent.message.errorMessage
              ? { error: agentEvent.message.errorMessage }
              : {}),
          });
          for (const block of agentEvent.message.content) {
            if (block.type === "toolCall") {
              this.#publish(runId, {
                type: "tool_requested",
                turnId: agentEvent.turnId,
                itemId: block.id,
                callId: block.id,
                tool: block.name,
                arguments: block.arguments,
              });
            }
          }
          if (agentEvent.message.stopReason === "error") {
            this.#runOutcome = "error";
          } else if (agentEvent.message.stopReason === "aborted") {
            this.#runOutcome = "cancelled";
          }
        }
        break;
      case "tool_execution_start":
        this.#store.setCheckpoint({
          sessionId: this.#session.id,
          runId,
          phase: "executing_tool",
          turnId: agentEvent.turnId,
          pendingCallId: agentEvent.toolCall.id,
          pendingTool: agentEvent.toolCall,
          updatedAt: Date.now(),
        });
        this.#publish(runId, {
          type: "tool_start",
          turnId: agentEvent.turnId,
          itemId: agentEvent.toolCall.id,
          callId: agentEvent.toolCall.id,
          tool: agentEvent.toolCall.name,
          arguments: agentEvent.toolCall.arguments,
        });
        break;
      case "tool_execution_end":
        this.#persistMessage(
          runId,
          agentEvent.turnId,
          agentEvent.result,
        );
        this.#publish(runId, {
          type: "tool_end",
          turnId: agentEvent.turnId,
          itemId: agentEvent.toolCall.id,
          callId: agentEvent.toolCall.id,
          tool: agentEvent.toolCall.name,
          isError: agentEvent.result.isError,
          output: agentEvent.result.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n"),
        });
        this.#store.setCheckpoint({
          sessionId: this.#session.id,
          runId,
          phase: "between_turns",
          turnId: agentEvent.turnId,
          updatedAt: Date.now(),
        });
        break;
      case "agent_end":
        this.#publish(runId, {
          type: "run_end",
          status: this.#runOutcome,
        });
        this.#store.setCheckpoint({
          sessionId: this.#session.id,
          runId,
          phase: "terminal",
          terminalStatus: this.#runOutcome,
          updatedAt: Date.now(),
        });
        this.#store.setLifecycle(this.#session.id, "idle");
        break;
    }
  }

  #recover(checkpoint: RunCheckpoint | undefined): void {
    if (!checkpoint || checkpoint.phase === "terminal") {
      return;
    }
    if (
      (checkpoint.phase === "awaiting_approval" ||
        checkpoint.phase === "approved_pending_exec") &&
      checkpoint.pendingApproval
    ) {
      const approval = checkpoint.pendingApproval;
      const events = this.snapshot().events.map(({ event }) => event);
      if (
        !events.some(
          (event) =>
            event.type === "approval_requested" &&
            event.approval.callId === approval.callId,
        )
      ) {
        this.#publish(checkpoint.runId, {
          type: "approval_requested",
          turnId: approval.turnId,
          itemId: `${approval.callId}:approval`,
          toolItemId: approval.callId,
          approval: {
            callId: approval.callId,
            tool: approval.tool,
            arguments: approval.arguments,
            effect: { ...approval.effect },
            effectDigest: approval.effectDigest,
            reason: approval.reason,
          },
        });
      }
      if (
        checkpoint.phase === "approved_pending_exec" &&
        !events.some(
          (event) =>
            event.type === "approval_resolved" &&
            event.callId === approval.callId,
        )
      ) {
        this.#publish(checkpoint.runId, {
          type: "approval_resolved",
          turnId: approval.turnId,
          itemId: `${approval.callId}:approval`,
          toolItemId: approval.callId,
          callId: approval.callId,
          approved: true,
        });
      }
    }
    if (
      checkpoint.phase === "executing_tool" &&
      checkpoint.pendingCallId &&
      this.snapshot().events.some(
        ({ event }) =>
          event.type === "tool_end" &&
          event.callId === checkpoint.pendingCallId,
      )
    ) {
      this.#recover({ ...checkpoint, phase: "between_turns" });
      return;
    }
    if (checkpoint.phase === "between_turns") {
      const lastAssistant = [...this.#agent.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      if (
        lastAssistant?.role === "assistant" &&
        (lastAssistant.stopReason === "stop" ||
          lastAssistant.stopReason === "length")
      ) {
        this.#publish(checkpoint.runId, {
          type: "run_end",
          status: "completed",
        });
        this.#store.setCheckpoint({
          ...checkpoint,
          phase: "terminal",
          terminalStatus: "completed",
          updatedAt: Date.now(),
        });
        this.#store.setLifecycle(this.#session.id, "idle");
        return;
      }
    }
    if (
      checkpoint.phase === "executing_tool" ||
      checkpoint.phase === "streaming" ||
      checkpoint.phase === "started" ||
      !checkpoint.turnId
    ) {
      this.#markCrashed(checkpoint);
      return;
    }
    if (
      checkpoint.phase === "awaiting_approval" ||
      checkpoint.phase === "approved_pending_exec" ||
      checkpoint.phase === "between_turns"
    ) {
      this.#activeRunId = checkpoint.runId;
      void this.#agent
        .resumePendingTools({
          runId: checkpoint.runId,
          turnId: checkpoint.turnId,
          turn: turnNumber(checkpoint.turnId),
        })
        .catch((error: unknown) =>
          this.#failRun(checkpoint.runId, error),
        )
        .finally(() => {
          if (this.#activeRunId === checkpoint.runId) {
            this.#activeRunId = null;
          }
        });
    }
  }

  #markCrashed(checkpoint: RunCheckpoint): void {
    this.#publish(checkpoint.runId, {
      type: "run_end",
      status: "crashed",
    });
    this.#store.setCheckpoint({
      ...checkpoint,
      phase: "terminal",
      terminalStatus: "crashed",
      updatedAt: Date.now(),
    });
    this.#store.setLifecycle(this.#session.id, "crashed");
  }

  #failRun(runId: string, error: unknown): void {
    this.#runOutcome = "error";
    this.#publish(runId, { type: "run_end", status: "error" });
    this.#store.setCheckpoint({
      sessionId: this.#session.id,
      runId,
      phase: "terminal",
      terminalStatus: "error",
      updatedAt: Date.now(),
    });
    this.#store.setLifecycle(this.#session.id, "idle");
    console.error("Coding agent run failed", error);
  }
}
