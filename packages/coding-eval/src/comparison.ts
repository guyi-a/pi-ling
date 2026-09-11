import type {
  ComparisonSummary,
  MeanDelta,
  MetricsComparison,
  RunResult,
  RunStatus,
} from "./types.js";
import { readLedger } from "./ledger.js";

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function meanDelta(baseline: number, candidate: number): MeanDelta {
  const base = roundMetric(baseline);
  const cand = roundMetric(candidate);
  return {
    baseline: base,
    candidate: cand,
    delta: roundMetric(cand - base),
  };
}

function comparisonKey(result: RunResult): string {
  const iteration = result.experiment_run?.iteration ?? 1;
  return `${result.task_id}#${String(iteration).padStart(3, "0")}`;
}

function validJudgeScore(result: RunResult): number | undefined {
  if (!result.judge || result.judge.error) return undefined;
  return result.judge.score;
}

interface MetricTotals {
  duration: number;
  tools: number;
  validation: number;
  gates: number;
  approvals: number;
  judge: number;
}

function addMetrics(target: MetricTotals, result: RunResult): void {
  target.duration += result.duration_ms;
  target.tools += result.metrics?.tool_calls ?? 0;
  target.validation += result.metrics?.validation_calls ?? 0;
  target.gates += result.metrics?.completion_gate_runs ?? 0;
  target.approvals += result.metrics?.approval_interrupts ?? 0;
}

function compareMetricTotals(
  baseline: MetricTotals,
  candidate: MetricTotals,
  pairs: number,
): MetricsComparison {
  const count = pairs || 1;
  return {
    duration_ms: meanDelta(baseline.duration / count, candidate.duration / count),
    tool_calls: meanDelta(baseline.tools / count, candidate.tools / count),
    validation_calls: meanDelta(
      baseline.validation / count,
      candidate.validation / count,
    ),
    completion_gate_runs: meanDelta(
      baseline.gates / count,
      candidate.gates / count,
    ),
    approval_interrupts: meanDelta(
      baseline.approvals / count,
      candidate.approvals / count,
    ),
    judge_score: meanDelta(0, 0),
    judge_pairs: 0,
  };
}

export interface CompareOptions {
  ledgerPath: string;
  experiment: string;
  baseline: string;
  candidate: string;
  baselineRuntime?: string;
  candidateRuntime?: string;
}

export async function compareLedger(
  options: CompareOptions,
): Promise<ComparisonSummary> {
  const summary: ComparisonSummary = {
    experiment: options.experiment,
    baseline: options.baseline,
    candidate: options.candidate,
    baseline_samples: 0,
    candidate_samples: 0,
    pairs: 0,
    baseline_pass_rate: 0,
    candidate_pass_rate: 0,
    pass_rate_lift: 0,
    metrics: compareMetricTotals(
      { duration: 0, tools: 0, validation: 0, gates: 0, approvals: 0, judge: 0 },
      { duration: 0, tools: 0, validation: 0, gates: 0, approvals: 0, judge: 0 },
      0,
    ),
    diagnostics: [],
  };

  const results = await readLedger(options.ledgerPath);
  const baselineRuns = new Map<string, RunResult>();
  const candidateRuns = new Map<string, RunResult>();

  for (const result of results) {
    if (!result.experiment_run) continue;
    if (result.experiment_run.experiment !== options.experiment) continue;
    const variant = result.experiment_run.variant;
    const runtime = result.runtime;
    const key = comparisonKey(result);
    if (variant === options.baseline) {
      if (baselineRuns.has(key)) {
        summary.diagnostics.push(
          `duplicate observation: ${variant}/${key}`,
        );
        continue;
      }
      baselineRuns.set(key, result);
    }
    if (variant === options.candidate) {
      if (candidateRuns.has(key)) {
        summary.diagnostics.push(
          `duplicate observation: ${variant}/${key}`,
        );
        continue;
      }
      candidateRuns.set(key, result);
    }
  }

  summary.baseline_samples = baselineRuns.size;
  summary.candidate_samples = candidateRuns.size;

  const keys = [
    ...new Set([...baselineRuns.keys(), ...candidateRuns.keys()]),
  ].sort();

  let baselinePasses = 0;
  let candidatePasses = 0;
  let judgePairs = 0;
  const baselineMetrics: MetricTotals = {
    duration: 0,
    tools: 0,
    validation: 0,
    gates: 0,
    approvals: 0,
    judge: 0,
  };
  const candidateMetrics: MetricTotals = {
    duration: 0,
    tools: 0,
    validation: 0,
    gates: 0,
    approvals: 0,
    judge: 0,
  };

  for (const key of keys) {
    const baselineResult = baselineRuns.get(key);
    const candidateResult = candidateRuns.get(key);
    if (!baselineResult || !candidateResult) {
      summary.diagnostics.push(
        `missing ${baselineResult ? options.candidate : options.baseline} observation: ${key}`,
      );
      continue;
    }
    summary.pairs += 1;
    if (baselineResult.status === "passed") baselinePasses += 1;
    if (candidateResult.status === "passed") candidatePasses += 1;
    addMetrics(baselineMetrics, baselineResult);
    addMetrics(candidateMetrics, candidateResult);
    const baselineJudge = validJudgeScore(baselineResult);
    const candidateJudge = validJudgeScore(candidateResult);
    if (baselineJudge !== undefined && candidateJudge !== undefined) {
      baselineMetrics.judge += baselineJudge;
      candidateMetrics.judge += candidateJudge;
      judgePairs += 1;
    } else if (baselineJudge !== undefined || candidateJudge !== undefined) {
      summary.diagnostics.push(`judge score present on one side only: ${key}`);
    }
  }

  if (summary.pairs > 0) {
    summary.baseline_pass_rate = baselinePasses / summary.pairs;
    summary.candidate_pass_rate = candidatePasses / summary.pairs;
    summary.pass_rate_lift =
      summary.candidate_pass_rate - summary.baseline_pass_rate;
    summary.metrics = compareMetricTotals(
      baselineMetrics,
      candidateMetrics,
      summary.pairs,
    );
    summary.metrics.judge_pairs = judgePairs;
    if (judgePairs > 0) {
      summary.metrics.judge_score = meanDelta(
        baselineMetrics.judge / judgePairs,
        candidateMetrics.judge / judgePairs,
      );
    }
  }

  summary.diagnostics.sort();
  return summary;
}

export interface TaskComparisonRow {
  taskId: string;
  title: string;
  baselineStatus: RunStatus | "missing";
  candidateStatus: RunStatus | "missing";
  statusChanged: boolean;
  durationDeltaMs?: number;
  toolCallsDelta?: number;
  violations?: string[];
}

function latestByTaskId(results: RunResult[]): Map<string, RunResult> {
  const map = new Map<string, RunResult>();
  for (const result of results) {
    map.set(result.task_id, result);
  }
  return map;
}

export function compareTaskRows(
  baselineResults: RunResult[],
  candidateResults: RunResult[],
): TaskComparisonRow[] {
  const baseline = latestByTaskId(baselineResults);
  const candidate = latestByTaskId(candidateResults);
  const taskIds = [
    ...new Set([...baseline.keys(), ...candidate.keys()]),
  ].sort();
  const rows: TaskComparisonRow[] = [];
  for (const taskId of taskIds) {
    const baselineResult = baseline.get(taskId);
    const candidateResult = candidate.get(taskId);
    const baselineStatus = baselineResult?.status ?? "missing";
    const candidateStatus = candidateResult?.status ?? "missing";
    const row: TaskComparisonRow = {
      taskId,
      title: candidateResult?.title ?? baselineResult?.title ?? taskId,
      baselineStatus,
      candidateStatus,
      statusChanged: baselineStatus !== candidateStatus,
    };
    if (baselineResult && candidateResult) {
      row.durationDeltaMs =
        candidateResult.duration_ms - baselineResult.duration_ms;
      const baselineTools = baselineResult.metrics?.tool_calls ?? 0;
      const candidateTools = candidateResult.metrics?.tool_calls ?? 0;
      row.toolCallsDelta = candidateTools - baselineTools;
    }
    if (candidateResult && candidateResult.score.violations.length > 0) {
      row.violations = candidateResult.score.violations;
    }
    rows.push(row);
  }
  return rows;
}
