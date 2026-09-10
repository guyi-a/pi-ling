import type { CanonicalMessage } from "@pi-ling/contracts";

/** One row in compaction scope, ordered like LingCoWork message rows. */
export interface CompactionRow {
  id: string;
  order: number;
  role: "user" | "assistant" | "tool";
  content: string;
  reasoning?: string;
  toolCalls?: string;
  toolName?: string;
  /** Provider context size after this message (assistant only). */
  totalTokens?: number;
}

export interface CompactionRecord {
  id: string;
  throughMessageId: string;
  summary: string;
  replacedMessageIds: string[];
  replacedCount: number;
  estimatedTokens: number;
}

export interface CompactionConfig {
  enabled: boolean;
  windowNominalTokens: number;
  windowUsableRatio: number;
  reservedOutputTokens: number;
  bufferTokens: number;
  keepLastUserTurns: number;
  charsPerToken: number;
  toolResultTruncateThresholdChars: number;
  toolResultTruncateKeepChars: number;
}

export interface CompactionPlan {
  folded: CompactionRow[];
  throughMessageId: string;
  priorSummary: string;
}

export type SummarizeFn = (
  folded: readonly CompactionRow[],
  priorSummary: string,
) => Promise<string>;

export interface MaybeCompactInput {
  rows: readonly CompactionRow[];
  active?: CompactionRecord;
  config: CompactionConfig;
  summarize: SummarizeFn;
}

export interface MaybeCompactResult {
  record: CompactionRecord;
  summaryMessage: CanonicalMessage;
}
