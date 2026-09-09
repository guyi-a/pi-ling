import { randomUUID } from "node:crypto";

import type {
  EvalRunAccepted,
  EvalRunResultView,
  EvalRunSuiteRequest,
  EvalRunTaskRequest,
  EvalSuiteProgressEvent,
} from "@pi-ling/contracts";
import type { WebContents } from "electron";

export const EVAL_PROGRESS_CHANNEL = "eval:progress";

type CodingEvalModule = typeof import("@pi-ling/coding-eval");
type RunResult = import("@pi-ling/coding-eval").RunResult;

function agentKeyConfigured(): boolean {
  return Boolean(
    process.env.DEEPSEEK_API_KEY?.trim() ||
      process.env.CODING_EVAL_JUDGE_API_KEY?.trim(),
  );
}

function toResultView(result: RunResult): EvalRunResultView {
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
}

export class EvalRunService {
  #webContents: WebContents | null = null;
  #activeRunId: string | null = null;
  #abortRequested = false;
  #abortController: AbortController | null = null;
  #running = false;
  #progressIndex = 0;
  #progressTotal = 0;
  #progressTaskId = "";

  bind(webContents: WebContents): void {
    this.#webContents = webContents;
  }

  isRunning(): boolean {
    return this.#running;
  }

  getActiveRunId(): string | null {
    return this.#activeRunId;
  }

  getActiveProgress():
    | { runId: string; index: number; total: number; taskId: string }
    | null {
    if (!this.#activeRunId || !this.#running) return null;
    return {
      runId: this.#activeRunId,
      index: this.#progressIndex,
      total: this.#progressTotal,
      taskId: this.#progressTaskId,
    };
  }

  cancel(): boolean {
    if (!this.#running) return false;
    this.#abortRequested = true;
    this.#abortController?.abort();
    return true;
  }

  async #loadCodingEval(): Promise<CodingEvalModule> {
    return import("@pi-ling/coding-eval");
  }

  #emit(event: EvalSuiteProgressEvent): void {
    this.#webContents?.send(EVAL_PROGRESS_CHANNEL, event);
  }

  #assertCanStart(driver: "reference" | "agent" | "noop"): void {
    if (this.#running) {
      throw new Error("An eval run is already in progress");
    }
    if (driver === "agent" && !agentKeyConfigured()) {
      throw new Error(
        "Agent eval requires DEEPSEEK_API_KEY or CODING_EVAL_JUDGE_API_KEY",
      );
    }
  }

  async startSuite(request: EvalRunSuiteRequest): Promise<EvalRunAccepted> {
    this.#assertCanStart(request.driver);
    const codingEval = await this.#loadCodingEval();
    const runId = randomUUID();
    const variant = codingEval.formatSuiteVariant(
      request.driver,
      request.runtime,
      request.variantLabel,
    );
    const accepted: EvalRunAccepted = {
      runId,
      experiment: codingEval.EVAL_PANEL_EXPERIMENT,
      variant,
    };
    void this.#executeRun({
      codingEval,
      runId,
      variant,
      driver: request.driver,
      runtime: request.runtime,
      scope: request.scope,
      ...(request.taskIds ? { taskIds: request.taskIds } : {}),
      ...(request.judgeMode ? { judgeMode: request.judgeMode } : {}),
    });
    return accepted;
  }

  async startTask(request: EvalRunTaskRequest): Promise<EvalRunAccepted> {
    this.#assertCanStart(request.driver);
    const codingEval = await this.#loadCodingEval();
    const runId = randomUUID();
    const variant = codingEval.formatSuiteVariant(
      request.driver,
      request.runtime,
      request.variantLabel,
    );
    const accepted: EvalRunAccepted = {
      runId,
      experiment: codingEval.EVAL_PANEL_EXPERIMENT,
      variant,
    };
    void this.#executeRun({
      codingEval,
      runId,
      variant,
      driver: request.driver,
      runtime: request.runtime,
      scope: "selected",
      taskIds: [request.taskId],
      judgeMode: request.judgeMode,
    });
    return accepted;
  }

  async #executeRun(options: {
    codingEval: CodingEvalModule;
    runId: string;
    variant: string;
    driver: EvalRunSuiteRequest["driver"];
    runtime: EvalRunSuiteRequest["runtime"];
    scope: EvalRunSuiteRequest["scope"];
    taskIds?: string[];
    judgeMode?: EvalRunSuiteRequest["judgeMode"];
  }): Promise<void> {
    const {
      codingEval,
      runId,
      variant,
      driver,
      runtime,
      scope,
      taskIds,
      judgeMode,
    } = options;
    this.#beginRun(runId);
    const { catalog } = codingEval.loadEffectiveCatalog();
    const ledgerPath = codingEval.defaultLedgerPath();
    try {
      const suiteOptions: Parameters<CodingEvalModule["runSuite"]>[0] = {
        catalog,
        ledgerPath,
        driver,
        runtime,
        scope,
        variant,
        judgeMode: judgeMode ?? "auto",
        shouldAbort: () => this.#abortRequested,
        onProgress: (event) => {
          this.#progressIndex = event.index;
          this.#progressTotal = event.total;
          this.#progressTaskId = event.taskId;
          this.#emit({
            runId,
            phase: event.phase,
            index: event.index,
            total: event.total,
            taskId: event.taskId,
            ...(event.error ? { error: event.error } : {}),
            ...(event.result ? { result: toResultView(event.result) } : {}),
          });
        },
      };
      if (taskIds) suiteOptions.taskIds = taskIds;
      if (this.#abortController) {
        suiteOptions.abortSignal = this.#abortController.signal;
      }
      await codingEval.runSuite(suiteOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#emit({
        runId,
        phase: "suite-error",
        index: this.#progressIndex,
        total: this.#progressTotal,
        taskId: this.#progressTaskId,
        error: message,
      });
    } finally {
      this.#endRun();
    }
  }

  #beginRun(runId: string): void {
    this.#activeRunId = runId;
    this.#abortRequested = false;
    this.#abortController = new AbortController();
    this.#running = true;
    this.#progressIndex = 0;
    this.#progressTotal = 0;
    this.#progressTaskId = "";
  }

  #endRun(): void {
    this.#running = false;
    this.#activeRunId = null;
    this.#abortController = null;
    this.#abortRequested = false;
    this.#progressIndex = 0;
    this.#progressTotal = 0;
    this.#progressTaskId = "";
  }
}

const services = new WeakMap<WebContents, EvalRunService>();

export function getEvalRunService(webContents: WebContents): EvalRunService {
  let service = services.get(webContents);
  if (!service) {
    service = new EvalRunService();
    service.bind(webContents);
    services.set(webContents, service);
  }
  return service;
}
