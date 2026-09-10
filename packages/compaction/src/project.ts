import type { CanonicalMessage, SessionEventEnvelope } from "@pi-ling/contracts";

import { activeRows } from "./estimate.js";
import { wrapSummary } from "./prompt.js";
import type { CompactionRecord, CompactionRow } from "./types.js";

export function summaryMessageText(record: CompactionRecord): string {
  return wrapSummary(record.id, record.summary);
}

export function projectAgentRows(
  rows: readonly CompactionRow[],
  active?: CompactionRecord,
): CompactionRow[] {
  return activeRows(rows, active);
}

export function projectAgentMessages(
  messages: readonly CanonicalMessage[],
  active: CompactionRecord | undefined,
  rows: readonly CompactionRow[],
): CanonicalMessage[] {
  if (!active) return [...messages];
  const activeIds = new Set(projectAgentRows(rows, active).map((row) => row.id));
  const kept = messages.filter((message) => activeIds.has(message.id));
  const summary: CanonicalMessage = {
    id: `compaction:${active.id}`,
    role: "user",
    sourceRuntime: kept[0]?.sourceRuntime ?? "native",
    createdAt: Date.now(),
    content: [{ type: "text", text: summaryMessageText(active) }],
    rawPayload: { internal: true, compaction: true, compactionId: active.id },
  };
  return [summary, ...kept];
}

export function findLatestCompactionRecord(
  events: readonly SessionEventEnvelope[],
): CompactionRecord | undefined {
  let latest: CompactionRecord | undefined;
  for (const envelope of events) {
    const event = envelope.event;
    if (event.kind !== "compaction.applied") continue;
    const summaryText = event.summary.content
      .filter(
        (block): block is Extract<(typeof event.summary.content)[number], { type: "text" }> =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("\n");
    latest = {
      id: event.compactionId,
      throughMessageId: event.throughMessageId,
      summary: summaryText,
      replacedMessageIds: [...event.replacedMessageIds],
      replacedCount: event.replacedCount ?? event.replacedMessageIds.length,
      estimatedTokens: event.estimatedTokens ?? 0,
    };
  }
  return latest;
}
