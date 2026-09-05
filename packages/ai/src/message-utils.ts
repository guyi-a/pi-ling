import { AssistantMessageEventStream } from "./event-stream.js";
import type {
  AssistantMessage,
  Model,
  StopReason,
  Usage,
} from "./types.js";

export function emptyUsage(): Usage {
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

export function calculateUsage(
  model: Model,
  values: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    reasoning?: number;
  },
): Usage {
  const cacheRead = values.cacheRead ?? 0;
  const cacheWrite = values.cacheWrite ?? 0;
  const inputCost = (values.input * model.cost.input) / 1_000_000;
  const outputCost = (values.output * model.cost.output) / 1_000_000;
  const cacheReadCost = (cacheRead * model.cost.cacheRead) / 1_000_000;
  const cacheWriteCost =
    (cacheWrite * model.cost.cacheWrite) / 1_000_000;
  const usage: Usage = {
    input: values.input,
    output: values.output,
    cacheRead,
    cacheWrite,
    totalTokens: values.input + values.output + cacheRead + cacheWrite,
    cost: {
      input: inputCost,
      output: outputCost,
      cacheRead: cacheReadCost,
      cacheWrite: cacheWriteCost,
      total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
    },
  };
  if (values.reasoning !== undefined) {
    usage.reasoning = values.reasoning;
  }
  return usage;
}

export function createAssistantMessage(model: Model): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

export function failedStream(
  model: Model,
  error: unknown,
  aborted = false,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = createAssistantMessage(model);
  const reason: Extract<StopReason, "error" | "aborted"> = aborted
    ? "aborted"
    : "error";
  message.stopReason = reason;
  message.errorMessage =
    error instanceof Error ? error.message : String(error);
  queueMicrotask(() => {
    stream.push({ type: "error", reason, error: message });
  });
  return stream;
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted")))
  );
}
