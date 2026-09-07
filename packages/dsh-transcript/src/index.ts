import type { Context } from "@deepseek-ai/cordis";
import type { AgentHandle } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-agent";
import {
  AssistantStreamAccumulator,
  MessageId,
  ToolCallId,
  createToolResultMessage,
  freezeMessage,
  type AssistantMessage,
  type AssistantStreamRecord,
  type ReplayEnvelope,
  type ToolCallBlock,
  type UserMessage,
} from "@deepseek-ai/dsh-llm";
import {
  SessionId,
  SessionSeq,
  type SessionEvent,
} from "@deepseek-ai/dsh-session";
import type {
  CanonicalContentBlock,
  CanonicalMessage,
} from "@pi-ling/contracts";

export const name = "pi-ling-transcript-seed";
export const inject = ["agents"];
export const serviceName = "piLingTranscriptSeed";

/** The DSH provider/model route attributed to historical assistant messages. */
export interface SeedProjection {
  provider: string;
  model: string;
  /** pi-ai API dialect, defaults to openai-completions for DeepSeek/Anthropic. */
  api?: string;
}

export interface SeededAgentOptions {
  sessionId: string;
  cwd: string;
  provider: string;
  model: string;
  messages: readonly CanonicalMessage[];
}

/** DSH content blocks derived from one canonical assistant message. */
interface ProjectedAssistant {
  content: Array<
    | { type: "text"; text: string }
    | { type: "reasoning"; text: string; signature?: string }
    | ToolCallBlock
  >;
  toolCalls: ToolCallBlock[];
}

function textOf(blocks: readonly CanonicalContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<CanonicalContentBlock, { type: "text" }> =>
      block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

function projectAssistantContent(
  blocks: readonly CanonicalContentBlock[],
): ProjectedAssistant {
  const content: ProjectedAssistant["content"] = [];
  const toolCalls: ToolCallBlock[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "reasoning") {
      content.push({
        type: "reasoning",
        text: block.text,
        ...(block.signature ? { signature: block.signature } : {}),
      });
    } else if (block.type === "tool-call") {
      const toolCall: ToolCallBlock = {
        type: "tool-call",
        id: ToolCallId(block.toolCallId),
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      };
      content.push(toolCall);
      toolCalls.push(toolCall);
    }
    // attachment blocks are out of scope for the text/tool/reasoning MVP.
  }
  return { content, toolCalls };
}

function assistantStream(
  content: ProjectedAssistant["content"],
  time: number,
  replayState?: ReplayEnvelope,
): readonly AssistantStreamRecord[] {
  const stream = new AssistantStreamAccumulator();
  const hasToolCall = content.some((block) => block.type === "tool-call");
  let clock = time;
  content.forEach((block, index) => {
    if (block.type === "text" || block.type === "reasoning") {
      stream.push({
        time: clock++,
        chunk: { type: "block-start", index, blockType: block.type },
      });
      stream.push({
        time: clock++,
        chunk:
          block.type === "text"
            ? { type: "text-delta", index, text: block.text }
            : { type: "reasoning-delta", index, text: block.text },
      });
      stream.push({
        time: clock++,
        chunk: { type: "block-end", index, block },
      });
      return;
    }
    stream.push({
      time: clock++,
      chunk: { type: "block-start", index, blockType: "tool-call" },
    });
    stream.push({
      time: clock++,
      chunk: {
        type: "tool-call-delta",
        index,
        id: block.id,
        name: block.name,
        argumentsDelta: block.arguments,
      },
    });
    stream.push({
      time: clock++,
      chunk: { type: "block-end", index, block },
    });
  });
  stream.push({
    time: clock++,
    chunk: {
      type: "finish",
      reason: hasToolCall ? { kind: "tool-calls" } : { kind: "stop" },
      ...(replayState === undefined ? {} : { replayState }),
    },
  });
  return stream.snapshot();
}

/** Build the pi-ai replay envelope shared by the source and the embedded stream. */
function replayStateFor(
  projected: ProjectedAssistant,
  projection: SeedProjection,
  hasToolCall: boolean,
): ReplayEnvelope {
  return {
    response: {
      kind: "pi-ai",
      version: 2,
      api: projection.api ?? "openai-completions",
      provider: projection.provider,
      model: projection.model,
      stopReason: hasToolCall ? "toolUse" : "stop",
    },
    blocks: projected.content.map((block) =>
      block.type === "reasoning"
        ? {
            type: "reasoning" as const,
            thinkingSignature: block.signature ?? "reasoning_content",
          }
        : block.type === "tool-call"
          ? { type: "tool-call" as const }
          : { type: "text" as const },
    ),
  };
}

export interface SeedOffset {
  /** Turn number of the first turn in this delta (defaults to 1). */
  startTurn?: number;
  /** Absolute seq of the first event in this delta (defaults to 0). */
  startSeq?: number;
}

export function toDshSeed(
  messages: readonly CanonicalMessage[],
  projection: SeedProjection,
  timestamp = Date.now(),
  offset: SeedOffset = {},
): SessionEvent[] {
  if (messages.length === 0) {
    throw new Error("Seed requires at least one canonical message");
  }
  const startSeq = offset.startSeq ?? 0;
  const events: SessionEvent[] = [];
  const push = (event: {
    type: string;
    data: unknown;
    surfaceOp?: "append";
    sourceEventSeqs?: number[];
  }) => {
    events.push({
      ...event,
      seq: SessionSeq(startSeq + events.length),
      time: timestamp + events.length,
    } as SessionEvent);
  };

  let turn = (offset.startTurn ?? 1) - 1;
  let step = 1;
  let stepOpen = false;
  let pendingToolResults = 0;
  const callSeqByCallId = new Map<string, number>();

  const openStep = (): void => {
    push({ type: "step/start", data: { turn, step } });
    stepOpen = true;
  };
  const closeStep = (): void => {
    if (!stepOpen) return;
    push({ type: "step/end", data: { turn, step } });
    step += 1;
    stepOpen = false;
  };
  const closeTurn = (): void => {
    if (turn === 0) return;
    closeStep();
    push({
      type: "turn/end",
      data: { turn, reason: { kind: "completed" } },
    });
  };

  for (const message of messages) {
    if (message.role === "user") {
      closeTurn();
      turn += 1;
      step = 1;
      pendingToolResults = 0;
      push({ type: "turn/start", data: { turn } });
      openStep();
      const userMessage = freezeMessage<UserMessage>({
        id: MessageId(message.id),
        role: "user",
        content: [{ type: "text", text: textOf(message.content) }],
        source: { kind: "user" },
      });
      push({
        type: "user/message",
        data: userMessage,
        surfaceOp: "append",
      });
    } else if (message.role === "assistant") {
      if (!stepOpen) openStep();
      const projected = projectAssistantContent(message.content);
      const hasToolCall = projected.toolCalls.length > 0;
      const replayState = replayStateFor(projected, projection, hasToolCall);
      const assistantMessage = freezeMessage<AssistantMessage>({
        id: MessageId(message.id),
        role: "assistant",
        content: projected.content,
        source: {
          kind: "model",
          provider: projection.provider,
          model: projection.model,
          replayState,
        },
      });
      const time = timestamp + events.length * 2;
      push({
        type: "assistant/message",
        data: {
          turn,
          step,
          message: assistantMessage,
          stream: assistantStream(projected.content, time, replayState),
        },
        surfaceOp: "append",
      });
      for (const toolCall of projected.toolCalls) {
        const seq = startSeq + events.length;
        push({
          type: "tool/call",
          data: {
            turn,
            step,
            callId: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        });
        callSeqByCallId.set(toolCall.id, seq);
      }
      if (projected.toolCalls.length > 0) {
        pendingToolResults = projected.toolCalls.length;
      } else {
        closeStep();
      }
    } else if (message.role === "tool") {
      const result = message.content.find(
        (block): block is Extract<CanonicalContentBlock, { type: "tool-result" }> =>
          block.type === "tool-result",
      );
      if (!result) {
        throw new Error("tool message must carry a tool-result block");
      }
      const resultMessage = createToolResultMessage({
        callId: ToolCallId(result.toolCallId),
        content: [{ type: "text", text: result.content }],
        isError: result.isError,
      });
      const callSeq = callSeqByCallId.get(result.toolCallId);
      push({
        type: "tool/result",
        data: { turn, step, message: resultMessage },
        surfaceOp: "append",
        ...(callSeq !== undefined ? { sourceEventSeqs: [callSeq] } : {}),
      });
      callSeqByCallId.delete(result.toolCallId);
      pendingToolResults -= 1;
      if (pendingToolResults <= 0) closeStep();
    }
  }
  closeTurn();
  return events;
}

export class PiLingTranscriptSeedService {
  constructor(private readonly ctx: Context) {}

  createAgent(options: SeededAgentOptions): Promise<AgentHandle> {
    return this.ctx.agents.create({
      sessionId: SessionId(options.sessionId),
      seed: toDshSeed(options.messages, {
        provider: options.provider,
        model: options.model,
      }),
      meta: { cwd: options.cwd },
      agentOptions: {
        provider: options.provider,
        model: options.model,
      },
    });
  }
}

export function apply(ctx: Context) {
  return ctx.provide(
    serviceName as never,
    new PiLingTranscriptSeedService(ctx) as never,
  );
}
