import { existsSync } from "node:fs";

import { readLedger } from "./ledger.js";
import type { RunResult } from "./types.js";

export interface EvalSuiteRunSummary {
  experiment: string;
  variant: string;
  driver: string;
  runtime?: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
}

const LEGACY_EXPERIMENT = "_legacy";
const LEGACY_VARIANT = "untagged";

function runKey(experiment: string, variant: string): string {
  return `${experiment}\0${variant}`;
}

function inferDriver(result: RunResult): string {
  if (result.driver.includes("agent")) return "agent";
  if (result.driver === "noop") return "noop";
  return "reference";
}

function accumulateRun(
  runs: Map<string, EvalSuiteRunSummary>,
  experiment: string,
  variant: string,
  result: RunResult,
): void {
  const key = runKey(experiment, variant);
  const existing = runs.get(key);
  if (!existing) {
    runs.set(key, {
      experiment,
      variant,
      driver: inferDriver(result),
      ...(result.runtime ? { runtime: result.runtime } : {}),
      startedAt: result.started_at,
      finishedAt: result.started_at,
      total: 1,
      passed: result.status === "passed" ? 1 : 0,
      failed: result.status === "failed" ? 1 : 0,
      skipped: result.status === "skipped" ? 1 : 0,
      errors: result.status === "error" ? 1 : 0,
    });
    return;
  }
  if (result.started_at < existing.startedAt) {
    existing.startedAt = result.started_at;
  }
  if (result.started_at > existing.finishedAt) {
    existing.finishedAt = result.started_at;
  }
  if (result.runtime && !existing.runtime) {
    existing.runtime = result.runtime;
  }
  existing.total += 1;
  switch (result.status) {
    case "passed":
      existing.passed += 1;
      break;
    case "failed":
      existing.failed += 1;
      break;
    case "skipped":
      existing.skipped += 1;
      break;
    default:
      existing.errors += 1;
      break;
  }
}

export async function listSuiteRuns(
  ledgerPath: string,
): Promise<EvalSuiteRunSummary[]> {
  if (!existsSync(ledgerPath)) return [];
  const results = await readLedger(ledgerPath);
  const runs = new Map<string, EvalSuiteRunSummary>();
  for (const result of results) {
    const experiment = result.experiment_run?.experiment ?? LEGACY_EXPERIMENT;
    const variant = result.experiment_run?.variant ?? LEGACY_VARIANT;
    accumulateRun(runs, experiment, variant, result);
  }
  return [...runs.values()].sort((left, right) =>
    right.finishedAt.localeCompare(left.finishedAt),
  );
}

export async function getRunResults(
  ledgerPath: string,
  experiment: string,
  variant: string,
): Promise<RunResult[]> {
  if (!existsSync(ledgerPath)) return [];
  const results = await readLedger(ledgerPath);
  return results.filter((result) => {
    const exp = result.experiment_run?.experiment ?? LEGACY_EXPERIMENT;
    const varnt = result.experiment_run?.variant ?? LEGACY_VARIANT;
    return exp === experiment && varnt === variant;
  });
}

export interface ComparePairSuggestion {
  experiment: string;
  baselineVariant: string;
  candidateVariant: string;
  baselineRuntime?: string;
  candidateRuntime?: string;
}

export function suggestComparePair(
  runs: EvalSuiteRunSummary[],
): ComparePairSuggestion | null {
  if (runs.length < 2) return null;

  const latest = runs[0]!;
  const previousSameDriver = runs.find(
    (run, index) =>
      index > 0 &&
      run.experiment === latest.experiment &&
      run.driver === latest.driver,
  );
  if (previousSameDriver) {
    return {
      experiment: latest.experiment,
      baselineVariant: previousSameDriver.variant,
      candidateVariant: latest.variant,
      ...(previousSameDriver.runtime
        ? { baselineRuntime: previousSameDriver.runtime }
        : {}),
      ...(latest.runtime ? { candidateRuntime: latest.runtime } : {}),
    };
  }

  const latestAgent = runs.find((run) => run.driver === "agent");
  const latestReference = runs.find((run) => run.driver === "reference");
  if (latestAgent && latestReference) {
    return {
      experiment: latestAgent.experiment,
      baselineVariant: latestReference.variant,
      candidateVariant: latestAgent.variant,
      ...(latestReference.runtime
        ? { baselineRuntime: latestReference.runtime }
        : {}),
      ...(latestAgent.runtime ? { candidateRuntime: latestAgent.runtime } : {}),
    };
  }

  const second = runs[1]!;
  return {
    experiment: latest.experiment,
    baselineVariant: second.variant,
    candidateVariant: latest.variant,
    ...(second.runtime ? { baselineRuntime: second.runtime } : {}),
    ...(latest.runtime ? { candidateRuntime: latest.runtime } : {}),
  };
}
