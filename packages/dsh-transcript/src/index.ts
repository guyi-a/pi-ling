import type { Context } from "@deepseek-ai/cordis";
import type { AgentHandle } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-agent";
import {
  AssistantStreamAccumulator,
  MessageId,
  freezeMessage,
  type AssistantMessage,
  type UserMessage,
} from "@deepseek-ai/dsh-llm";
import {
  SessionId,
  SessionSeq,
  type SessionEvent,
} from "@deepseek-ai/dsh-session";

export const name = "pi-ling-transcript-seed";
export const inject = ["agents"];
export const serviceName = "piLingTranscriptSeed";

export type CanonicalSeedMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      provider: string;
      model: string;
    };

export interface SeededAgentOptions {
  sessionId: string;
  cwd: string;
  provider: string;
  model: string;
  messages: readonly CanonicalSeedMessage[];
}

function assistantStream(text: string, time: number) {
  const stream = new AssistantStreamAccumulator();
  stream.push({
    time,
    chunk: { type: "block-start", index: 0, blockType: "text" },
  });
  stream.push({
    time,
    chunk: { type: "text-delta", index: 0, text },
  });
  stream.push({
    time,
    chunk: {
      type: "block-end",
      index: 0,
      block: { type: "text", text },
    },
  });
  stream.push({
    time,
    chunk: { type: "finish", reason: { kind: "stop" } },
  });
  return stream.snapshot();
}

export function toDshSeed(
  messages: readonly CanonicalSeedMessage[],
  timestamp = Date.now(),
): SessionEvent[] {
  if (messages.length === 0 || messages.length % 2 !== 0) {
    throw new Error("Seed PoC requires complete user/assistant pairs");
  }
  const events: SessionEvent[] = [];
  const push = (event: {
    type: string;
    data: unknown;
    surfaceOp?: "append";
  }) => {
    events.push({
      ...event,
      seq: SessionSeq(events.length),
      time: timestamp + events.length,
    } as SessionEvent);
  };

  for (let index = 0; index < messages.length; index += 2) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user?.role !== "user" || assistant?.role !== "assistant") {
      throw new Error("Seed PoC expects alternating user/assistant messages");
    }
    if (!user.text || !assistant.text) {
      throw new Error("Seed PoC requires non-empty text messages");
    }
    const turn = index / 2 + 1;
    const step = 1;
    const userMessage = freezeMessage<UserMessage>({
      id: MessageId(user.id),
      role: "user",
      content: [{ type: "text", text: user.text }],
      source: { kind: "user" },
    });
    const assistantMessage = freezeMessage<AssistantMessage>({
      id: MessageId(assistant.id),
      role: "assistant",
      content: [{ type: "text", text: assistant.text }],
      source: {
        kind: "model",
        provider: assistant.provider,
        model: assistant.model,
      },
    });

    push({ type: "turn/start", data: { turn } });
    push({ type: "step/start", data: { turn, step } });
    push({
      type: "user/message",
      data: userMessage,
      surfaceOp: "append",
    });
    push({
      type: "assistant/message",
      data: {
        turn,
        step,
        message: assistantMessage,
        stream: [
          ...assistantStream(assistant.text, timestamp + events.length),
        ],
      },
      surfaceOp: "append",
    });
    push({ type: "step/end", data: { turn, step } });
    push({
      type: "turn/end",
      data: { turn, reason: { kind: "completed" } },
    });
  }
  return events;
}

export class PiLingTranscriptSeedService {
  constructor(private readonly ctx: Context) {}

  createAgent(options: SeededAgentOptions): Promise<AgentHandle> {
    return this.ctx.agents.create({
      sessionId: SessionId(options.sessionId),
      seed: toDshSeed(options.messages),
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
