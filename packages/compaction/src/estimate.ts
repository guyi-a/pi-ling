import { charsPerToken } from "./config.js";
import type { CompactionConfig, CompactionRecord, CompactionRow } from "./types.js";

const estimatedImageTokens = 384;
const imageMarkerRE = /(?:^|\n)\[image:\s*.+?\]\s*$/gm;

export function activeRows(
  rows: readonly CompactionRow[],
  active?: CompactionRecord,
): CompactionRow[] {
  if (!active) return [...rows];
  const index = rows.findIndex((row) => row.id === active.throughMessageId);
  if (index < 0) return [...rows];
  return rows.slice(index + 1);
}

function roughTokens(rows: readonly CompactionRow[], cpt: number): number {
  let chars = 0;
  let imageTokens = 0;
  for (const row of rows) {
    chars +=
      row.content.length +
      (row.reasoning?.length ?? 0) +
      (row.toolCalls?.length ?? 0);
    const markers = row.content.match(imageMarkerRE);
    if (markers) {
      imageTokens += markers.length * estimatedImageTokens;
    }
  }
  return Math.floor(chars / cpt) + imageTokens;
}

export function estimateTokens(
  rows: readonly CompactionRow[],
  active: CompactionRecord | undefined,
  config: CompactionConfig,
): number {
  const scope = activeRows(rows, active);
  let anchorIndex = -1;
  for (let index = scope.length - 1; index >= 0; index -= 1) {
    const tokens = scope[index]?.totalTokens;
    if (tokens !== undefined && tokens > 0) {
      anchorIndex = index;
      break;
    }
  }

  const cpt = charsPerToken(config);
  if (anchorIndex >= 0) {
    const anchor = scope[anchorIndex]!;
    return anchor.totalTokens! + roughTokens(scope.slice(anchorIndex + 1), cpt);
  }

  let total = roughTokens(scope, cpt);
  if (active) {
    total += Math.floor(active.summary.length / cpt);
  }
  return total;
}
