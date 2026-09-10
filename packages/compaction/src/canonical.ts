import type { CanonicalContentBlock, CanonicalMessage } from "@pi-ling/contracts";

import type { CompactionRow } from "./types.js";

function blockText(blocks: readonly CanonicalContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<CanonicalContentBlock, { type: "text" }> =>
      block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

function blockReasoning(blocks: readonly CanonicalContentBlock[]): string {
  return blocks
    .filter(
      (block): block is Extract<CanonicalContentBlock, { type: "reasoning" }> =>
        block.type === "reasoning",
    )
    .map((block) => block.text)
    .join("\n");
}

function blockToolCalls(blocks: readonly CanonicalContentBlock[]): string {
  return JSON.stringify(
    blocks
      .filter(
        (block): block is Extract<CanonicalContentBlock, { type: "tool-call" }> =>
          block.type === "tool-call",
      )
      .map((block) => ({
        id: block.toolCallId,
        name: block.name,
        input: block.input,
      })),
  );
}

function toolResultContent(blocks: readonly CanonicalContentBlock[]): string {
  return blocks
    .filter(
      (block): block is Extract<CanonicalContentBlock, { type: "tool-result" }> =>
        block.type === "tool-result",
    )
    .map((block) => block.content)
    .join("\n");
}

function toolResultName(
  message: CanonicalMessage,
): string | undefined {
  const raw = message.rawPayload?.toolName;
  return typeof raw === "string" ? raw : undefined;
}

export function canonicalToCompactionRows(
  messages: readonly CanonicalMessage[],
  tokenAnchors?: ReadonlyMap<string, number>,
): CompactionRow[] {
  return messages.map((message, order) => {
    if (message.role === "user") {
      return {
        id: message.id,
        order,
        role: "user",
        content: blockText(message.content),
      };
    }
    if (message.role === "assistant") {
      const reasoning = blockReasoning(message.content);
      const toolCalls = blockToolCalls(message.content);
      const totalTokens = tokenAnchors?.get(message.id);
      return {
        id: message.id,
        order,
        role: "assistant",
        content: blockText(message.content),
        ...(reasoning ? { reasoning } : {}),
        ...(toolCalls ? { toolCalls } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
      };
    }
    const toolName = toolResultName(message);
    return {
      id: message.id,
      order,
      role: "tool",
      content: toolResultContent(message.content),
      ...(toolName ? { toolName } : {}),
    };
  });
}

export function buildTokenAnchorsFromEvents(
  events: readonly {
    event: { kind: string; message?: CanonicalMessage; contextUsage?: { used: number } };
  }[],
): Map<string, number> {
  const anchors = new Map<string, number>();
  for (const envelope of events) {
    const event = envelope.event;
    if (
      event.kind === "message.assistant.committed" &&
      event.message &&
      event.contextUsage
    ) {
      anchors.set(event.message.id, event.contextUsage.used);
    }
  }
  return anchors;
}
