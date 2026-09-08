import {
  CodingAgent,
  Workspace,
  type ApprovalDecision,
  type ApprovalRequest as RuntimeApprovalRequest,
  type CodingAgentEvent,
  type FileBaseline,
} from "@pi-ling/coding-agent";
import {
  createModels,
  type AssistantMessage,
  type Message,
  type ToolCall,
  type ToolResultMessage,
  type Usage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type {
  AgentStatus,
  AgentUsage,
  CanonicalMessage,
  ChangedFile,
  FileDiff,
  PromptAttachment,
  SessionSummary,
  RuntimeKind,
  SessionEventEnvelope,
  TimelineEnvelope,
  TimelineSnapshot,
} from "@pi-ling/contracts";
import {
  projectCanonicalMessages,
  TimelineProjector,
} from "@pi-ling/session-events";

import { RunMessageBuffer } from "./run-message-buffer.js";
import { diffLineStats } from "./diff-stats.js";
import {
  canonicalFromMessage,
  SessionStore,
  type RunCheckpoint,
} from "./session-store/session-store.js";

const PROVIDER = "deepseek";
const MODEL = "deepseek-v4-pro";
const VISION_MODEL = "deepseek-v4-flash-vision-exp";
const models = createModels();
models.setProvider(deepseekProvider());

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function turnNumber(turnId: string): number {
  const value = Number(turnId.match(/:turn:(\d+)$/)?.[1]);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

async function nativeMessages(
  canonical: readonly CanonicalMessage[],
  workspace: Workspace,
): Promise<Message[]> {
  const toolNames = new Map<string, string>();
  const output: Message[] = [];
  for (const message of canonical) {
    if (message.role === "user") {
      const native = message.rawPayload?.native as UserMessage | undefined;
      if (
        native?.role === "user" &&
        Array.isArray(native.content) &&
        native.content.some((block) => block.type === "image")
      ) {
        output.push({
          ...native,
          timestamp: message.createdAt,
        });
        continue;
      }
      const blocks: Exclude<UserMessage["content"], string> = [];
      for (const block of message.content) {
        if (block.type === "text") {
          blocks.push({ type: "text", text: block.text });
        } else if (block.type === "attachment") {
          const attachmentId = block.attachmentId?.trim();
          if (!attachmentId || attachmentId.startsWith("inline:")) {
            continue;
          }
          try {
            const image = await workspace.readImage(attachmentId);
            blocks.push({
              type: "image",
              data: image.data,
              mimeType: image.mimeType,
            });
          } catch {
            blocks.push({
              type: "text",
              text: `[attachment unavailable: ${attachmentId}]`,
            });
          }
        }
      }
      if (blocks.length === 0) continue;
      output.push({
        role: "user",
        content:
          blocks.length === 1 && blocks[0]?.type === "text"
            ? blocks[0].text
            : blocks,
        timestamp: message.createdAt,
      });
    } else if (message.role === "assistant") {
      const content: AssistantMessage["content"] = [];
      for (const block of message.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "tool-call") {
          toolNames.set(block.toolCallId, block.name);
          content.push({
            type: "toolCall",
            id: block.toolCallId,
            name: block.name,
            arguments: block.input,
          });
        }
        // reasoning blocks are not valid in openai-completions (DeepSeek) — skip
      }
      if (content.length === 0) continue;
      output.push({
        role: "assistant",
        content,
        api: "openai-completions",
        provider: "deepseek",
        model: MODEL,
        usage: emptyUsage(),
        stopReason: content.some((block) => block.type === "toolCall")
          ? "toolUse"
          : "stop",
        timestamp: message.createdAt,
      });
    } else {
      const native = message.rawPayload?.native as ToolResultMessage | undefined;
      if (native?.role === "toolResult") {
        output.push({
          ...native,
          timestamp: message.createdAt,
        });
        continue;
      }
      for (const block of message.content) {
        if (block.type !== "tool-result") continue;
        output.push({
          role: "toolResult",
          toolCallId: block.toolCallId,
          toolName: toolNames.get(block.toolCallId) ?? "unknown",
          content: [{ type: "text", text: block.content }],
          isError: block.isError,
          timestamp: message.createdAt,
        });
      }
    }
  }
  return output;
}

async function buildUserPromptMessage(
  workspace: Workspace,
  prompt: string,
  attachments: readonly PromptAttachment[],
): Promise<UserMessage> {
  const blocks: Exclude<UserMessage["content"], string> = [];
  for (const attachment of attachments) {
    const image = await workspace.readImage(attachment.relativePath);
    blocks.push({
      type: "image",
      data: image.data,
      mimeType: image.mimeType,
    });
  }
  if (prompt.trim()) {
    blocks.push({ type: "text", text: prompt.trim() });
  }
  return {
    role: "user",
    content: blocks,
    timestamp: Date.now(),
  };
}

function buildCanonicalUserMessage(
  runId: string,
  prompt: string,
  attachments: readonly PromptAttachment[],
): CanonicalMessage {
  const content: CanonicalMessage["content"] = [
    ...attachments.map((attachment) => ({
      type: "attachment" as const,
      attachmentId: attachment.relativePath,
      mediaType: attachment.mediaType,
      name: attachment.name,
    })),
    ...(prompt.trim() ? [{ type: "text" as const, text: prompt.trim() }] : []),
  ];
  return {
    id: `${runId}:user`,
    role: "user",
    content,
    sourceRuntime: "native",
    createdAt: Date.now(),
  };
}

export class PiAgentSession {
  readonly #store: SessionStore;
  readonly #session: SessionSummary;
  readonly #emit: (envelope: TimelineEnvelope) => void;
  readonly #agent: CodingAgent;
  readonly #availableRuntimes: RuntimeKind[];
  readonly #buffer: RunMessageBuffer;
  readonly #projector: TimelineProjector;
  #activeRunId: string | null = null;
  #runOutcome: "completed" | "cancelled" | "error" = "completed";

  private constructor(
    store: SessionStore,
    session: SessionSummary,
    emit: (envelope: TimelineEnvelope) => void,
    agent: CodingAgent,
    availableRuntimes: RuntimeKind[],
    buffer: RunMessageBuffer,
  ) {
    this.#store = store;
    this.#session = session;
    this.#emit = emit;
    this.#agent = agent;
    this.#availableRuntimes = availableRuntimes;
    this.#buffer = buffer;
    this.#projector = new TimelineProjector(
      session.id,
      store.loadSessionEvents(session.id),
    );
  }

  static async open(options: {
    store: SessionStore;
    session: SessionSummary;
    emit: (envelope: TimelineEnvelope) => void;
    availableRuntimes?: RuntimeKind[];
    buffer?: RunMessageBuffer;
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
    const canonical = projectCanonicalMessages(
      options.store.loadSessionEvents(options.session.id),
    );
    const workspace = await Workspace.open(options.session.workspace.root);
    const restoredMessages =
      canonical.length > 0
        ? await nativeMessages(canonical, workspace)
        : options.store.loadMessages(options.session.id);
    const agent = await CodingAgent.create({
      workspaceRoot: options.session.workspace.root,
      model,
      streamFn: models.streamSimple.bind(models),
      messages: restoredMessages,
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
      options.buffer ?? new RunMessageBuffer(() => {}),
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
    return this.#projector.snapshot();
  }

  startPrompt(
    runId: string,
    prompt: string,
    attachments: PromptAttachment[] = [],
  ): void {
    if (this.#activeRunId || this.#agent.isStreaming) {
      throw new Error("Agent is already processing a prompt");
    }
    this.#activeRunId = runId;
    this.#runOutcome = "completed";
    this.#store.setLifecycle(this.#session.id, "running", runId);
    const userMessage = buildCanonicalUserMessage(runId, prompt, attachments);
    const started = this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "native",
      runId,
      messageId: userMessage.id,
      idempotencyKey: `run:${runId}:start`,
      event: { kind: "run.started", userMessage },
    });
    this.#store.setCheckpoint({
      sessionId: this.#session.id,
      runId,
      phase: "started",
      runtimeKind: "native",
      lastDurableSeq: started.seq,
      updatedAt: Date.now(),
    });
    this.#flush(started);
    void (async () => {
      try {
        const hasImages = attachments.length > 0;
        const targetModelId = hasImages ? VISION_MODEL : MODEL;
        const model = models.getModel(PROVIDER, targetModelId);
        if (!model) {
          throw new Error(`Model is unavailable: ${PROVIDER}/${targetModelId}`);
        }
        this.#agent.setModel(model);
        const userPrompt = hasImages
          ? await buildUserPromptMessage(
              this.#agent.workspace,
              prompt,
              attachments,
            )
          : prompt;
        await this.#agent.prompt(userPrompt, runId);
      } catch (error: unknown) {
        this.#failRun(runId, error);
      } finally {
        if (this.#activeRunId === runId) {
          this.#activeRunId = null;
        }
      }
    })();
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

  #flush(envelope: SessionEventEnvelope): void {
    for (const next of this.#projector.push(envelope)) {
      this.#emit(next);
    }
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
      const productApproval = {
        callId: approval.callId,
        tool: approval.tool,
        arguments: approval.arguments,
        effect: { ...approval.effect },
        effectDigest: approval.effectDigest,
        reason: approval.reason,
      };
      const pendingTool: ToolCall = {
        type: "toolCall",
        id: approval.callId,
        name: approval.tool,
        arguments: approval.arguments,
      };
      this.#store.savePendingApproval(this.#session.id, approval);
      const durable = this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "native",
        runId: approval.runId,
        turnId: approval.turnId,
        toolCallId: approval.callId,
        idempotencyKey: `approval:${approval.callId}:requested`,
        event: {
          kind: "approval.requested",
          toolItemId: approval.callId,
          approval: productApproval,
        },
      });
      this.#store.setCheckpoint({
        sessionId: this.#session.id,
        runId: approval.runId,
        phase: "awaiting_approval",
        turnId: approval.turnId,
        pendingCallId: approval.callId,
        pendingTool,
        pendingApproval: approval,
        runtimeKind: "native",
        lastDurableSeq: durable.seq,
        updatedAt: Date.now(),
      });
      this.#store.setLifecycle(
        this.#session.id,
        "awaiting_approval",
        approval.runId,
      );
      this.#flush(durable);
      return;
    }
    if (event.type === "approval_resolved") {
      const checkpoint = this.#store.getCheckpoint(
        this.#session.id,
        event.runId,
      );
      const durable = this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "native",
        runId: event.runId,
        turnId: event.turnId,
        toolCallId: event.callId,
        idempotencyKey: `approval:${event.callId}:resolved`,
        event: {
          kind: "approval.resolved",
          toolItemId: event.callId,
          callId: event.callId,
          approved: event.approved,
        },
      });
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
        runtimeKind: "native",
        lastDurableSeq: durable.seq,
        updatedAt: Date.now(),
      });
      this.#store.deletePendingApproval(this.#session.id, event.callId);
      this.#store.setLifecycle(this.#session.id, "running", event.runId);
      this.#flush(durable);
      return;
    }
    if (event.type === "changes") {
      for (const baseline of this.#agent.baselines()) {
        this.#store.saveBaseline(this.#session.id, baseline);
      }
      const files = await Promise.all(
        event.files.map(async (file) => {
          if (file.binary || file.sensitive || file.tooLarge) return file;
          const diff = await this.#agent.diff(file.path);
          return diff ? { ...file, ...diffLineStats(diff.patch) } : file;
        }),
      );
      const changesCommitted = this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "native",
        runId: event.runId,
        turnId: event.turnId,
        toolCallId: event.callId,
        idempotencyKey: `changes:${event.callId}`,
        event: {
          kind: "changes.committed",
          callId: event.callId,
          files,
        },
      });
      this.#flush(changesCommitted);
      return;
    }

    const agentEvent = event.event;
    const runId = agentEvent.runId;
    switch (agentEvent.type) {
      case "agent_start":
        break;
      case "turn_start":
        {
          const durable = this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "native",
            runId,
            turnId: agentEvent.turnId,
            idempotencyKey: `turn:${agentEvent.turnId}:start`,
            event: { kind: "turn.started", turn: agentEvent.turn },
          });
        this.#store.setCheckpoint({
          sessionId: this.#session.id,
          runId,
          phase: "streaming",
          turnId: agentEvent.turnId,
          runtimeKind: "native",
          lastDurableSeq: durable.seq,
          updatedAt: Date.now(),
        });
        this.#flush(durable);
        }
        break;
      case "turn_end":
        {
          const durable = this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "native",
            runId,
            turnId: agentEvent.turnId,
            idempotencyKey: `turn:${agentEvent.turnId}:end`,
            event: { kind: "turn.ended" },
          });
        this.#store.setCheckpoint({
          sessionId: this.#session.id,
          runId,
          phase: "between_turns",
          turnId: agentEvent.turnId,
          runtimeKind: "native",
          lastDurableSeq: durable.seq,
          updatedAt: Date.now(),
        });
        this.#flush(durable);
        }
        break;
      case "message_start":
        break;
      case "message_update":
        if (agentEvent.assistantMessageEvent.type === "text_delta") {
          this.#buffer.ingest({
            sessionId: this.#session.id,
            runId,
            turnId: agentEvent.turnId,
            messageId: `${agentEvent.turnId}:assistant`,
            emittedAt: Date.now(),
            frame: {
              kind: "assistant.text.delta",
              delta: agentEvent.assistantMessageEvent.delta,
            },
          });
        } else if (
          agentEvent.assistantMessageEvent.type === "thinking_delta"
        ) {
          this.#buffer.ingest({
            sessionId: this.#session.id,
            runId,
            turnId: agentEvent.turnId,
            messageId: `${agentEvent.turnId}:assistant`,
            emittedAt: Date.now(),
            frame: {
              kind: "assistant.reasoning.delta",
              delta: agentEvent.assistantMessageEvent.delta,
            },
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
          const messageId = `${agentEvent.turnId}:assistant`;
          const canonical = canonicalFromMessage(
            agentEvent.message,
            messageId,
            "native",
            agentEvent.message.timestamp,
          );
          const committed = this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "native",
            runId,
            turnId: agentEvent.turnId,
            messageId,
            idempotencyKey: `assistant:${agentEvent.turnId}`,
            event: {
              kind: "message.assistant.committed",
              message: canonical,
              stopReason: agentEvent.message.stopReason,
              usage,
              ...(agentEvent.message.errorMessage
                ? { error: agentEvent.message.errorMessage }
                : {}),
            },
          });
          this.#buffer.commitMessage(this.#session.id, runId, messageId);
          this.#flush(committed);
          for (const block of agentEvent.message.content) {
            if (block.type === "toolCall") {
              this.#flush(
                this.#store.appendSessionEvent({
                  sessionId: this.#session.id,
                  runtimeKind: "native",
                  runId,
                  turnId: agentEvent.turnId,
                  toolCallId: block.id,
                  idempotencyKey: `tool:${block.id}:call`,
                  event: {
                    kind: "tool.call.committed",
                    toolCall: {
                      id: block.id,
                      name: block.name,
                      input: block.arguments,
                    },
                  },
                }),
              );
            }
          }
          this.#store.setCheckpoint({
            sessionId: this.#session.id,
            runId,
            phase:
              agentEvent.message.stopReason === "toolUse"
                ? "between_turns"
                : "streaming",
            turnId: agentEvent.turnId,
            runtimeKind: "native",
            lastDurableSeq: committed.seq,
            updatedAt: Date.now(),
          });
          if (agentEvent.message.stopReason === "error") {
            this.#runOutcome = "error";
          } else if (agentEvent.message.stopReason === "aborted") {
            this.#runOutcome = "cancelled";
          }
        }
        break;
      case "tool_execution_start":
        {
          const durable = this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "native",
            runId,
            turnId: agentEvent.turnId,
            toolCallId: agentEvent.toolCall.id,
            idempotencyKey: `tool:${agentEvent.toolCall.id}:start`,
            event: {
              kind: "tool.execution.started",
              toolCallId: agentEvent.toolCall.id,
            },
          });
          this.#store.setCheckpoint({
            sessionId: this.#session.id,
            runId,
            phase: "executing_tool",
            turnId: agentEvent.turnId,
            pendingCallId: agentEvent.toolCall.id,
            pendingTool: agentEvent.toolCall,
            updatedAt: Date.now(),
            runtimeKind: "native",
            lastDurableSeq: durable.seq,
          });
          this.#flush(durable);
        }
        break;
      case "tool_execution_end":
        this.#persistMessage(
          runId,
          agentEvent.turnId,
          agentEvent.result,
        );
        {
          const output = agentEvent.result.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
          const durable = this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "native",
            runId,
            turnId: agentEvent.turnId,
            messageId: `tool:${agentEvent.toolCall.id}`,
            toolCallId: agentEvent.toolCall.id,
            idempotencyKey: `tool:${agentEvent.toolCall.id}:result`,
            event: {
              kind: "tool.result.committed",
              result: {
                toolCallId: agentEvent.toolCall.id,
                content: output,
                isError: agentEvent.result.isError,
                rawPayload: { native: agentEvent.result },
              },
            },
          });
        this.#flush(durable);
        this.#store.setCheckpoint({
          sessionId: this.#session.id,
          runId,
          phase: "between_turns",
          turnId: agentEvent.turnId,
          runtimeKind: "native",
          lastDurableSeq: durable.seq,
          updatedAt: Date.now(),
        });
        }
        break;
      case "agent_end":
        {
          const durable = this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "native",
            runId,
            idempotencyKey: `run:${runId}:end`,
            event: { kind: "run.ended", status: this.#runOutcome },
          });
        this.#flush(durable);
        this.#store.setCheckpoint({
          sessionId: this.#session.id,
          runId,
          phase: "terminal",
          terminalStatus: this.#runOutcome,
          runtimeKind: "native",
          lastDurableSeq: durable.seq,
          updatedAt: Date.now(),
        });
        this.#store.setLifecycle(this.#session.id, "idle");
        this.#buffer.endRun(this.#session.id, runId);
        }
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
      // Projector already folded durable approval events during open().
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
        this.#flush(
          this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "native",
            runId: checkpoint.runId,
            idempotencyKey: `run:${checkpoint.runId}:end`,
            event: { kind: "run.ended", status: "completed" },
          }),
        );
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
    const durable = this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "native",
      runId: checkpoint.runId,
      idempotencyKey: `run:${checkpoint.runId}:end`,
      event: { kind: "run.ended", status: "crashed" },
    });
    this.#flush(durable);
    this.#store.setCheckpoint({
      ...checkpoint,
      phase: "terminal",
      terminalStatus: "crashed",
      runtimeKind: "native",
      lastDurableSeq: durable.seq,
      updatedAt: Date.now(),
    });
    this.#store.setLifecycle(this.#session.id, "crashed");
    this.#buffer.endRun(this.#session.id, checkpoint.runId);
  }

  #failRun(runId: string, error: unknown): void {
    const cancelled =
      this.#runOutcome === "cancelled" ||
      (error instanceof Error && error.name === "AbortError");
    this.#runOutcome = cancelled ? "cancelled" : "error";
    const durable = this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "native",
      runId,
      idempotencyKey: `run:${runId}:end`,
      event: { kind: "run.ended", status: this.#runOutcome },
    });
    this.#flush(durable);
    this.#store.setCheckpoint({
      sessionId: this.#session.id,
      runId,
      phase: "terminal",
      terminalStatus: this.#runOutcome,
      runtimeKind: "native",
      lastDurableSeq: durable.seq,
      updatedAt: Date.now(),
    });
    this.#store.setLifecycle(this.#session.id, "idle");
    this.#buffer.endRun(this.#session.id, runId);
    console.error("Coding agent run failed", error);
  }
}
