import { randomUUID } from "node:crypto";

import type { CanonicalMessage } from "@pi-ling/contracts";

import { thresholdTokens } from "./config.js";
import { estimateTokens } from "./estimate.js";
import { wrapSummary } from "./prompt.js";
import { split } from "./split.js";
import type { CompactionRecord, MaybeCompactInput, MaybeCompactResult } from "./types.js";

export function summaryMessageForRecord(
  record: CompactionRecord,
  sourceRuntime: CanonicalMessage["sourceRuntime"],
): CanonicalMessage {
  return {
    id: `compaction:${record.id}`,
    role: "user",
    sourceRuntime,
    createdAt: Date.now(),
    content: [{ type: "text", text: wrapSummary(record.id, record.summary) }],
    rawPayload: { internal: true, compaction: true, compactionId: record.id },
  };
}

export async function maybeCompact(
  input: MaybeCompactInput,
): Promise<MaybeCompactResult | undefined> {
  if (!input.config.enabled || input.rows.length === 0) {
    return undefined;
  }

  const estimated = estimateTokens(input.rows, input.active, input.config);
  const threshold = thresholdTokens(input.config);
  if (estimated < threshold) {
    return undefined;
  }

  const plan = split(input.rows, input.active, input.config.keepLastUserTurns);
  if (!plan) {
    return undefined;
  }

  let summary: string;
  try {
    summary = await input.summarize(plan.folded, plan.priorSummary);
  } catch {
    return undefined;
  }
  if (!summary.trim()) {
    return undefined;
  }

  const record: CompactionRecord = {
    id: randomUUID(),
    throughMessageId: plan.throughMessageId,
    summary: summary.trim(),
    replacedMessageIds: plan.folded.map((row) => row.id),
    replacedCount: plan.folded.length,
    estimatedTokens: estimated,
  };

  const sourceRuntime =
    input.rows.find((row) => row.role === "user")?.role === "user"
      ? ("native" as const)
      : "native";

  return {
    record,
    summaryMessage: summaryMessageForRecord(record, sourceRuntime),
  };
}
