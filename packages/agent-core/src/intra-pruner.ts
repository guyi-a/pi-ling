import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";

function envInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface IntraPrunerConfig {
  keepRecentToolResults: number;
  headChars: number;
  tailChars: number;
}

export function defaultIntraPrunerConfig(): IntraPrunerConfig {
  return {
    keepRecentToolResults: envInt("INTRA_PRUNE_KEEP_TOOL_RESULTS", 8),
    headChars: envInt("INTRA_PRUNE_HEAD_CHARS", 4_000),
    tailChars: envInt("INTRA_PRUNE_TAIL_CHARS", 4_000),
  };
}

function truncateText(value: string, head: number, tail: number): string {
  if (value.length <= head + tail + 64) return value;
  const omitted = value.length - head - tail;
  return (
    value.slice(0, head) +
    `\n\n[… ${omitted} chars pruned from in-run context …]\n\n` +
    value.slice(value.length - tail)
  );
}

function pruneToolResult(
  message: ToolResultMessage,
  head: number,
  tail: number,
): ToolResultMessage {
  return {
    ...message,
    content: message.content.map((block) => {
      if (block.type !== "text") return block;
      return {
        ...block,
        text: truncateText(block.text, head, tail),
      };
    }),
  };
}

/** In-memory truncation of older completed tool results before each model call. */
export function pruneContextToolResults(
  messages: readonly Message[],
  config: IntraPrunerConfig = defaultIntraPrunerConfig(),
): Message[] {
  const toolIndexes: number[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === "toolResult") {
      toolIndexes.push(index);
    }
  }
  if (toolIndexes.length <= config.keepRecentToolResults) {
    return [...messages];
  }

  const pruneBefore =
    toolIndexes[toolIndexes.length - config.keepRecentToolResults]!;
  return messages.map((message, index) => {
    if (index >= pruneBefore || message.role !== "toolResult") {
      return message;
    }
    return pruneToolResult(message, config.headChars, config.tailChars);
  });
}
