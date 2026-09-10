import type { EvalTab } from "./useEvalWorkbench";

export const EVAL_TAB_LABELS: Record<EvalTab, string> = {
  catalog: "任务库",
  results: "结果",
  compare: "对比",
};

export function formatStatsText(input: {
  total: number;
  baseline: number;
  judged: number;
}): string {
  return `共 ${input.total} 项 · ${input.baseline} 条基线 · ${input.judged} 条已评判`;
}
