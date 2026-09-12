import { existsSync } from "node:fs";

import type {
  EvalCompareRequest,
  EvalCompareView,
  EvalPanelSnapshot,
  EvalRunAccepted,
  EvalRunResultView,
  EvalRunSuiteRequest,
  EvalRunTaskRequest,
  EvalTaskDetail,
  EvalTaskOverrideRequest,
  EvalTaskView,
  EvalValidateCatalogResult,
  EvalWorkbenchState,
} from "@pi-ling/contracts";
import { resolve } from "node:path";

import { app, shell } from "electron";
import type { WebContents } from "electron";

import { resolveCodexLaunchConfig } from "./codex-launch-config.js";
import { resolveDshLaunchConfig } from "./dsh-launch-config.js";
import { getEvalRunService } from "./eval-run-service.js";

function availableEvalRuntimes(): Array<"native" | "dsh" | "codex"> {
  const runtimes: Array<"native" | "dsh" | "codex"> = ["native"];
  const userDataPath = app.getPath("userData");
  const repoRoot = process.env["PI_LING_REPO_ROOT"]?.trim()
    ? resolve(process.env["PI_LING_REPO_ROOT"])
    : undefined;
  const dshLaunch = resolveDshLaunchConfig(
    process.env,
    userDataPath,
    undefined,
    repoRoot,
  );
  if (dshLaunch.enabled && "options" in dshLaunch) {
    runtimes.push("dsh");
  }
  const codexLaunch = resolveCodexLaunchConfig(
    process.env,
    userDataPath,
    repoRoot,
  );
  if (codexLaunch.enabled && "options" in codexLaunch) {
    runtimes.push("codex");
  }
  return runtimes;
}

type CodingEvalModule = typeof import("@pi-ling/coding-eval");
type RunResult = import("@pi-ling/coding-eval").RunResult;

async function loadCodingEval(): Promise<CodingEvalModule> {
  try {
    return await import("@pi-ling/coding-eval");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Eval harness unavailable (${message}). Run pnpm install and pnpm --filter @pi-ling/coding-eval build from the repo root.`,
    );
  }
}

function toTaskView(
  codingEval: CodingEvalModule,
  task: import("@pi-ling/coding-eval").TaskSpec,
  overrideIds: Set<string>,
): EvalTaskView {
  const prompt = codingEval.effectivePrompt(task);
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    ...(task.difficulty ? { difficulty: task.difficulty } : {}),
    enabled: task.enabled,
    baselineIncluded: task.baseline.included,
    hasJudge: Boolean(task.judge),
    promptPreview:
      prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt,
    hasLocalOverride: overrideIds.has(task.id),
  };
}

function toResultViews(results: RunResult[]): EvalRunResultView[] {
  return results.map((result) => {
    const verifyPassed = result.verification.filter(
      (row) => row.exit_code === 0,
    ).length;
    return {
      taskId: result.task_id,
      title: result.title,
      status: result.status,
      durationMs: result.duration_ms,
      verifyPassed,
      verifyTotal: result.verification.length,
      violations: result.score.violations,
      ...(result.metrics?.tool_calls !== undefined
        ? { toolCalls: result.metrics.tool_calls }
        : {}),
      ...(result.judge?.score !== undefined
        ? { judgeScore: result.judge.score }
        : {}),
      ...(result.judge?.rationale
        ? { judgeRationale: result.judge.rationale }
        : {}),
      ...(result.judge?.error ? { judgeError: result.judge.error } : {}),
      ...(result.error ? { error: result.error } : {}),
      verifyDetails: result.verification.map((row) => ({
        name: row.name,
        exitCode: row.exit_code,
        ...(row.stdout ? { stdout: row.stdout } : {}),
        ...(row.stderr ? { stderr: row.stderr } : {}),
      })),
    };
  });
}

export async function getEvalRunResults(
  experiment: string,
  variant: string,
): Promise<EvalRunResultView[]> {
  const codingEval = await loadCodingEval();
  const ledgerPath = codingEval.defaultLedgerPath();
  const results = await codingEval.getRunResults(ledgerPath, experiment, variant);
  return toResultViews(results);
}

export async function getEvalWorkbenchState(
  webContents?: WebContents,
): Promise<EvalWorkbenchState> {
  const codingEval = await loadCodingEval();
  const effective = codingEval.loadEffectiveCatalog();
  const ledgerPath = codingEval.defaultLedgerPath();
  const dataDir = codingEval.resolveEvalDataDir();
  const overrides = codingEval.loadOverrides(effective.overridesPath);
  const overrideIds = new Set(Object.keys(overrides.tasks));
  const stats = codingEval.catalogStats(effective.catalog);
  const runs = await codingEval.listSuiteRuns(ledgerPath);
  const latest = runs[0];
  const latestRun = latest
    ? {
        experiment: latest.experiment,
        variant: latest.variant,
        results: toResultViews(
          await codingEval.getRunResults(
            ledgerPath,
            latest.experiment,
            latest.variant,
          ),
        ),
      }
    : undefined;
  const suggestedCompare = codingEval.suggestComparePair(runs);
  const service = webContents ? getEvalRunService(webContents) : null;
  const progress = service?.getActiveProgress();

  return {
    stats,
    dataDir,
    ledgerPath,
    catalogPath: effective.catalogPath,
    overridesPath: effective.overridesPath,
    availableEvalRuntimes: availableEvalRuntimes(),
    tasks: effective.catalog.tasks.map((task) =>
      toTaskView(codingEval, task, overrideIds),
    ),
    runs,
    ...(latestRun ? { latestRun } : {}),
    ...(suggestedCompare
      ? {
          suggestedCompare: {
            experiment: suggestedCompare.experiment,
            baselineVariant: suggestedCompare.baselineVariant,
            candidateVariant: suggestedCompare.candidateVariant,
            ...(suggestedCompare.baselineRuntime
              ? { baselineRuntime: suggestedCompare.baselineRuntime }
              : {}),
            ...(suggestedCompare.candidateRuntime
              ? { candidateRuntime: suggestedCompare.candidateRuntime }
              : {}),
          },
        }
      : {}),
    ...(progress
      ? {
          activeRun: {
            runId: progress.runId,
            index: progress.index,
            total: progress.total,
            taskId: progress.taskId,
            status: "running" as const,
          },
        }
      : {}),
  };
}

export async function getEvalSnapshot(): Promise<EvalPanelSnapshot> {
  const state = await getEvalWorkbenchState();
  const codingEval = await loadCodingEval();
  const snapshot: EvalPanelSnapshot = {
    stats: state.stats,
    ledgerPath: state.ledgerPath,
  };
  if (existsSync(state.ledgerPath)) {
    snapshot.ledger = await codingEval.summarizeLedger(state.ledgerPath);
  }
  return snapshot;
}

export async function compareEvalRuns(
  request: EvalCompareRequest,
): Promise<EvalCompareView> {
  const codingEval = await loadCodingEval();
  const ledgerPath = codingEval.defaultLedgerPath();
  const summary = await codingEval.compareLedger({
    ledgerPath,
    experiment: request.experiment,
    baseline: request.baselineVariant,
    candidate: request.candidateVariant,
    ...(request.baselineRuntime
      ? { baselineRuntime: request.baselineRuntime }
      : {}),
    ...(request.candidateRuntime
      ? { candidateRuntime: request.candidateRuntime }
      : {}),
  });
  const baselineResults = await codingEval.getRunResults(
    ledgerPath,
    request.experiment,
    request.baselineVariant,
  );
  const candidateResults = await codingEval.getRunResults(
    ledgerPath,
    request.experiment,
    request.candidateVariant,
  );
  return {
    summary,
    taskRows: codingEval.compareTaskRows(baselineResults, candidateResults),
  };
}

export async function getEvalTaskDetail(
  taskId: string,
): Promise<EvalTaskDetail> {
  const codingEval = await loadCodingEval();
  const effective = codingEval.loadEffectiveCatalog();
  const overrides = codingEval.loadOverrides(effective.overridesPath);
  const overrideIds = new Set(Object.keys(overrides.tasks));
  const task = effective.catalog.tasks.find((row) => row.id === taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const base = toTaskView(codingEval, task, overrideIds);
  return {
    ...base,
    prompt: codingEval.effectivePrompt(task),
    fixtureFiles: Object.keys(task.fixture.files),
    fixtureCommand: task.fixture.command,
    verify: task.verify.map((row) => ({
      name: row.name,
      command: row.command,
    })),
    scoring: task.scoring,
    ...(task.judge ? { judge: task.judge } : {}),
  };
}

export async function saveEvalTaskOverride(
  request: EvalTaskOverrideRequest,
): Promise<EvalWorkbenchState> {
  const codingEval = await loadCodingEval();
  const effective = codingEval.loadEffectiveCatalog();
  const patch: import("@pi-ling/coding-eval").TaskOverridePatch = {};
  if (request.enabled !== undefined) {
    patch.enabled = request.enabled;
    if (!request.enabled) {
      patch.disabled_reason =
        request.disabledReason?.trim() || "disabled via eval panel";
    }
  }
  if (request.prompt !== undefined) patch.prompt = request.prompt;
  if (request.baselineIncluded !== undefined) {
    const baseTask = codingEval.loadCatalog(effective.catalogPath).tasks.find(
      (row) => row.id === request.taskId,
    );
    if (!baseTask) throw new Error(`task ${request.taskId} not found`);
    patch.baseline = {
      ...baseTask.baseline,
      included: request.baselineIncluded,
    };
  }
  codingEval.saveTaskOverride(
    effective.overridesPath,
    effective.catalogPath,
    request.taskId,
    patch,
  );
  return getEvalWorkbenchState();
}

export async function clearEvalTaskOverride(
  taskId: string,
): Promise<EvalWorkbenchState> {
  const codingEval = await loadCodingEval();
  const effective = codingEval.loadEffectiveCatalog();
  codingEval.clearTaskOverride(
    effective.overridesPath,
    effective.catalogPath,
    taskId,
  );
  return getEvalWorkbenchState();
}

export async function openEvalCatalog(): Promise<boolean> {
  const codingEval = await loadCodingEval();
  const { catalogPath } = codingEval.loadEffectiveCatalog();
  const result = await shell.openPath(catalogPath);
  return result === "";
}

export async function validateEvalCatalog(): Promise<EvalValidateCatalogResult> {
  try {
    const codingEval = await loadCodingEval();
    const { catalog } = codingEval.loadEffectiveCatalog();
    codingEval.validateCatalog(catalog);
    const stats = codingEval.catalogStats(catalog);
    return {
      valid: true,
      message: `Valid: ${stats.total} tasks`,
      stats,
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runEvalSuite(
  webContents: WebContents,
  request: EvalRunSuiteRequest,
): Promise<EvalRunAccepted> {
  return getEvalRunService(webContents).startSuite(request);
}

export async function runEvalTask(
  webContents: WebContents,
  request: EvalRunTaskRequest,
): Promise<EvalRunAccepted> {
  return getEvalRunService(webContents).startTask(request);
}

export function cancelEvalRun(webContents: WebContents): boolean {
  return getEvalRunService(webContents).cancel();
}
