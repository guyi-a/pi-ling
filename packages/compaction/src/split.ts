import { activeRows } from "./estimate.js";
import type {
  CompactionPlan,
  CompactionRecord,
  CompactionRow,
} from "./types.js";

function hasAssistantContent(rows: readonly CompactionRow[]): boolean {
  return rows.some((row) => row.role === "assistant" || row.role === "tool");
}

export function split(
  rows: readonly CompactionRow[],
  active: CompactionRecord | undefined,
  keepLastUserTurns: number,
): CompactionPlan | undefined {
  const scope = activeRows(rows, active);
  if (scope.length === 0) return undefined;

  const priorSummary = active?.summary ?? "";
  let cut = scope.length;

  if (keepLastUserTurns > 0) {
    const userIndexes: number[] = [];
    for (let index = 0; index < scope.length; index += 1) {
      if (scope[index]?.role === "user") {
        userIndexes.push(index);
      }
    }
    if (userIndexes.length <= keepLastUserTurns) {
      return undefined;
    }
    cut = userIndexes[userIndexes.length - keepLastUserTurns]!;
  }

  if (cut <= 0) return undefined;
  const folded = scope.slice(0, cut);
  if (!hasAssistantContent(folded)) return undefined;

  const throughMessageId = folded.at(-1)?.id;
  if (!throughMessageId) return undefined;

  return {
    folded,
    throughMessageId,
    priorSummary,
  };
}
