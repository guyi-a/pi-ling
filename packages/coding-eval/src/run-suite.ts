import { createAgentDriver } from "./agent-drivers/index.js";
import {
  judgeConfigFromEnv,
  judgeEnabled,
  LlmJudge,
  type Judge,
} from "./judge.js";
import { findTask, loadCatalog } from "./manifest.js";
import { runTask } from "./runner.js";
import type {
  Catalog,
  EvalDriver,
  EvalRuntime,
  ExperimentRun,
  RunResult,
  TaskSpec,
} from "./types.js";

export const EVAL_PANEL_EXPERIMENT = "eval-panel";

export interface EvalSuiteProgressEvent {
  phase: "task-start" | "task-done" | "suite-done" | "suite-error";
  index: number;
  total: number;
  taskId: string;
  result?: RunResult;
  error?: string;
}

export interface RunSuiteSummary {
  experiment: string;
  variant: string;
  driver: EvalDriver;
  runtime: EvalRuntime;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  aborted: boolean;
  unexpected: number;
}

export interface RunSuiteOptions {
  catalog: Catalog;
  ledgerPath: string;
  driver: EvalDriver;
  runtime: EvalRuntime;
  scope: "baseline" | "full" | "selected";
  taskIds?: string[];
  experiment?: string;
  variant?: string;
  repetitions?: number;
  judgeMode?: "auto" | "on" | "off";
  judgeThreshold?: number;
  keep?: boolean;
  onProgress?: (event: EvalSuiteProgressEvent) => void;
  shouldAbort?: () => boolean;
  abortSignal?: AbortSignal;
}

export function resolveJudge(
  mode: string,
  threshold: number,
): { judge: Judge | null; threshold: number } {
  if (threshold < 0 || threshold > 1) {
    throw new Error("judge-threshold must be in [0,1]");
  }
  if (mode === "off") return { judge: null, threshold };
  const config = judgeConfigFromEnv();
  if (!judgeEnabled(config)) {
    if (mode === "on") {
      throw new Error(
        "judge requested but no provider key: set CODING_EVAL_JUDGE_API_KEY or DEEPSEEK_API_KEY",
      );
    }
    return { judge: null, threshold };
  }
  return { judge: new LlmJudge(config), threshold };
}

export function selectTasks(
  catalog: Catalog,
  scope: RunSuiteOptions["scope"],
  taskIds?: string[],
): TaskSpec[] {
  if (scope === "selected") {
    if (!taskIds || taskIds.length === 0) {
      throw new Error("selected scope requires taskIds");
    }
    const tasks: TaskSpec[] = [];
    for (const taskId of taskIds) {
      const task = findTask(catalog, taskId);
      if (!task) throw new Error(`task ${taskId} not found`);
      tasks.push(task);
    }
    return tasks;
  }
  const full = scope === "full";
  return catalog.tasks.filter(
    (task) => task.enabled && (full || task.baseline.included),
  );
}

export function formatSuiteVariant(
  driver: EvalDriver,
  runtime: EvalRuntime,
  label?: string,
): string {
  if (label?.trim()) return label.trim();
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `${driver}-${runtime}-${stamp}`;
}

export async function runOneTask(
  task: TaskSpec,
  options: {
    driver: EvalDriver;
    runtime: EvalRuntime;
    ledgerPath: string;
    keep: boolean;
    experiment?: ExperimentRun;
    judge: Judge | null;
    judgeThreshold: number;
    abortSignal?: AbortSignal;
  },
): Promise<{ result: RunResult; exitCode: number }> {
  if (options.driver === "reference") {
    const result = await runTask(task, {
      ledgerPath: options.ledgerPath,
      keep: options.keep,
      ...(options.experiment ? { experiment: options.experiment } : {}),
      driver: "reference-command",
      judge: options.judge,
      judgeThreshold: options.judgeThreshold,
    });
    return { result, exitCode: result.status === "passed" ? 0 : 1 };
  }
  if (options.driver === "noop") {
    const result = await runTask(task, {
      ledgerPath: options.ledgerPath,
      keep: options.keep,
      ...(options.experiment ? { experiment: options.experiment } : {}),
      skipAction: true,
      driver: "noop",
    });
    return { result, exitCode: result.status === "failed" ? 0 : 1 };
  }

  const agentDriver = createAgentDriver(options.runtime);
  const result = await runTask(task, {
    ledgerPath: options.ledgerPath,
    keep: options.keep,
    ...(options.experiment ? { experiment: options.experiment } : {}),
    driver: agentDriver.name,
    runtime: options.runtime,
    approvalMode: "auto",
    judge: options.judge,
    judgeThreshold: options.judgeThreshold,
    action: (worktree, currentTask, timeoutMs) =>
      agentDriver.run(
        worktree,
        currentTask,
        timeoutMs,
        options.abortSignal
          ? { abortSignal: options.abortSignal }
          : undefined,
      ),
  });
  return { result, exitCode: result.status === "passed" ? 0 : 1 };
}

export async function runSuite(options: RunSuiteOptions): Promise<RunSuiteSummary> {
  const repetitions = options.repetitions ?? 1;
  if (repetitions < 1 || repetitions > 100) {
    throw new Error("repetitions must be in [1,100]");
  }

  const experiment = options.experiment ?? EVAL_PANEL_EXPERIMENT;
  const variant = formatSuiteVariant(
    options.driver,
    options.runtime,
    options.variant,
  );
  const judgeMode = options.judgeMode ?? "auto";
  const judgeThreshold = options.judgeThreshold ?? 0;
  const { judge, threshold } =
    options.driver === "noop"
      ? { judge: null, threshold: 0 }
      : resolveJudge(judgeMode, judgeThreshold);

  const tasks = selectTasks(options.catalog, options.scope, options.taskIds);
  const total = tasks.length * repetitions;
  let index = 0;
  let unexpected = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let errors = 0;
  let aborted = false;

  const emit = (event: EvalSuiteProgressEvent) => {
    options.onProgress?.(event);
  };

  try {
    for (const task of tasks) {
      if (options.shouldAbort?.()) {
        aborted = true;
        break;
      }
      for (let iteration = 1; iteration <= repetitions; iteration += 1) {
        if (options.shouldAbort?.()) {
          aborted = true;
          break;
        }
        index += 1;
        emit({
          phase: "task-start",
          index,
          total,
          taskId: task.id,
        });
        const experimentRun: ExperimentRun = {
          experiment,
          variant,
          iteration,
        };
        const runOptions: Parameters<typeof runOneTask>[1] = {
          driver: options.driver,
          runtime: options.runtime,
          ledgerPath: options.ledgerPath,
          keep: options.keep ?? false,
          experiment: experimentRun,
          judge,
          judgeThreshold: threshold,
        };
        if (options.abortSignal) {
          runOptions.abortSignal = options.abortSignal;
        }
        const { result, exitCode } = await runOneTask(task, runOptions);
        switch (result.status) {
          case "passed":
            passed += 1;
            break;
          case "failed":
            failed += 1;
            break;
          case "skipped":
            skipped += 1;
            break;
          default:
            errors += 1;
            break;
        }
        if (exitCode !== 0) unexpected += 1;
        emit({
          phase: "task-done",
          index,
          total,
          taskId: task.id,
          result,
        });
      }
      if (aborted) break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({
      phase: "suite-error",
      index,
      total,
      taskId: "",
      error: message,
    });
    throw error;
  }

  emit({
    phase: "suite-done",
    index,
    total,
    taskId: "",
  });

  if (!aborted) {
    if (options.driver === "noop" && unexpected > 0) {
      throw new Error(`${unexpected} noop task(s) did not fail as expected`);
    }
    if (options.driver === "reference" && unexpected > 0) {
      throw new Error(`${unexpected} reference task(s) failed`);
    }
  }

  return {
    experiment,
    variant,
    driver: options.driver,
    runtime: options.runtime,
    total: index,
    passed,
    failed,
    skipped,
    errors,
    aborted,
    unexpected,
  };
}

export function loadCatalogForSuite(catalogPath: string): Catalog {
  return loadCatalog(catalogPath);
}
