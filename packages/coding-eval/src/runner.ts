import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Judge } from "./judge.js";
import { runJudge, applyJudgeThreshold } from "./judge.js";
import { writeResponseFile } from "./response-file.js";
import { scoreWorktree } from "./score-worktree.js";
import { runShell } from "./shell.js";
import type { AgentRunOptions } from "./agent-drivers/types.js";
import type {
  CommandResult,
  ExperimentRun,
  RunResult,
  TaskSpec,
} from "./types.js";

export interface RunOptions {
  ledgerPath?: string;
  artifactDir?: string;
  experiment?: ExperimentRun;
  keep?: boolean;
  skipAction?: boolean;
  judge?: Judge | null;
  judgeThreshold?: number;
  driver?: string;
  runtime?: string;
  approvalMode?: string;
  abortSignal?: AbortSignal;
  action?: (
    worktree: string,
    task: TaskSpec,
    runOptions?: AgentRunOptions,
  ) => Promise<{
    action: CommandResult;
    metrics?: RunResult["metrics"];
    response?: string;
    error?: string;
  }>;
}

function cloneExperiment(
  experiment?: ExperimentRun,
): ExperimentRun | undefined {
  if (!experiment) return undefined;
  return { ...experiment };
}

async function createFixture(
  source: string,
  worktree: string,
  files: Record<string, string>,
): Promise<void> {
  await mkdir(source, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = join(source, ...name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  const commands = [
    ["init", "-q"],
    ["config", "user.email", "coding-eval@localhost"],
    ["config", "user.name", "Coding Eval"],
    ["config", "core.autocrlf", "false"],
    ["add", "."],
    ["commit", "-qm", "fixture baseline"],
    ["worktree", "add", "--detach", worktree, "HEAD"],
  ];
  for (const args of commands) {
    try {
      execFileSync("git", ["-C", source, ...args], { stdio: "pipe" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`git ${args.join(" ")}: ${message}`);
    }
  }
}

async function cleanupWorktree(
  source: string,
  worktree: string,
  root: string,
  keep: boolean,
): Promise<void> {
  if (keep) return;
  try {
    execFileSync("git", ["-C", source, "worktree", "remove", "--force", worktree], {
      stdio: "ignore",
    });
  } catch {
    // best effort
  }
  await rm(root, { recursive: true, force: true });
}

export async function runTask(
  task: TaskSpec,
  options: RunOptions = {},
): Promise<RunResult> {
  const started = Date.now();
  const driver =
    options.driver ??
    (options.skipAction ? "noop" : options.action ? "agent" : "reference-command");
  const result: RunResult = {
    task_id: task.id,
    title: task.title,
    driver,
    ...(options.runtime ? { runtime: options.runtime } : {}),
    ...(options.experiment
      ? { experiment_run: cloneExperiment(options.experiment)! }
      : {}),
    ...(options.approvalMode ? { approval_mode: options.approvalMode } : {}),
    started_at: new Date(started).toISOString(),
    duration_ms: 0,
    status: "error",
    action: { name: "action", command: "", exit_code: -1, duration_ms: 0 },
    verification: [],
    score: {
      passed: false,
      violations: [],
      diff: {
        changed_files: 0,
        added_lines: 0,
        deleted_lines: 0,
        paths: [],
      },
    },
  };

  let root = "";
  let source = "";
  let worktree = "";

  try {
    if (!task.enabled) {
      result.status = "skipped";
      result.error = `task ${task.id} is disabled: ${task.disabled_reason ?? ""}`;
      return result;
    }

    root = await mkdtemp(join(tmpdir(), `coding-eval-${task.id}-`));
    source = join(root, "source");
    worktree = join(root, "worktree");
    if (options.keep) result.worktree = worktree;

    await createFixture(source, worktree, task.fixture.files);
    const timeoutMs = task.timeout_seconds * 1000;

    if (options.skipAction) {
      result.action = { name: "noop", command: "", exit_code: 0, duration_ms: 0 };
    } else if (options.action) {
      const agentRunOptions: AgentRunOptions = {};
      if (options.abortSignal) {
        agentRunOptions.abortSignal = options.abortSignal;
      }
      const actionResult = await options.action(worktree, task, agentRunOptions);
      result.action = actionResult.action;
      if (actionResult.metrics) {
        result.metrics = actionResult.metrics;
      }
      if (actionResult.response) {
        await writeResponseFile(worktree, actionResult.response);
      }
      if (actionResult.error) {
        result.status = "failed";
        result.error = actionResult.error;
        result.score = scoreWorktree(worktree, task.scoring);
        return result;
      }
      if (result.action.exit_code !== 0) {
        result.status = "failed";
        result.error = result.action.stderr ?? "agent action failed";
        result.score = scoreWorktree(worktree, task.scoring);
        return result;
      }
    } else {
      result.action = await runShell(
        "action",
        task.fixture.command,
        worktree,
        timeoutMs,
      );
      if (result.action.exit_code !== 0) {
        result.status = "failed";
        result.error = "fixture action failed";
        result.score = scoreWorktree(worktree, task.scoring);
        return result;
      }
    }

    for (const verify of task.verify) {
      const commandResult = await runShell(
        verify.name,
        verify.command,
        worktree,
        timeoutMs,
      );
      result.verification.push(commandResult);
      if (commandResult.exit_code !== 0) {
        result.status = "failed";
      }
    }

    result.score = scoreWorktree(worktree, task.scoring);
    if (result.status !== "failed" && result.score.passed) {
      result.status = "passed";
    } else {
      result.status = "failed";
    }

    if (options.judge && task.judge) {
      result.judge = await runJudge(options.judge, task, worktree);
      applyJudgeThreshold(result, options.judgeThreshold ?? 0);
    }
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  } finally {
    result.duration_ms = Date.now() - started;
    if (options.ledgerPath) {
      const { appendLedger } = await import("./ledger.js");
      await appendLedger(options.ledgerPath, result);
    }
    await cleanupWorktree(source, worktree, root, options.keep ?? false);
  }
}

export function marshalResult(result: RunResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
