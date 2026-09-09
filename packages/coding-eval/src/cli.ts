#!/usr/bin/env node
import { compareLedger } from "./comparison.js";
import {
  catalogStats,
  defaultCatalogPath,
  findTask,
  loadCatalog,
  validateCatalog,
} from "./manifest.js";
import { summarizeLedger } from "./ledger.js";
import { defaultLedgerPath } from "./paths.js";
import { marshalResult, runTask } from "./runner.js";
import {
  loadCatalogForSuite,
  resolveJudge,
  runOneTask,
  runSuite,
} from "./run-suite.js";
import type { EvalDriver, EvalRuntime } from "./types.js";

function usage(): void {
  console.error(
    "usage: coding-eval <list|validate|run|run-agent|run-suite|summary|compare> [options]",
  );
}

function parseArgs(argv: string[]): {
  command: string;
  args: string[];
} {
  if (argv.length === 0) {
    usage();
    process.exit(1);
  }
  return { command: argv[0] ?? "", args: argv.slice(1) };
}

function parseFlags(args: string[]): {
  flags: Map<string, string | boolean>;
  positionals: string[];
} {
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    index += 1;
  }
  return { flags, positionals };
}

function flagString(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: string,
): string {
  const value = flags.get(key);
  return typeof value === "string" ? value : fallback;
}

function flagBoolean(
  flags: Map<string, string | boolean>,
  key: string,
  fallback = false,
): boolean {
  const value = flags.get(key);
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return value !== "false" && value !== "0";
}

function flagInt(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: number,
): number {
  const value = flags.get(key);
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(argv: string[]): Promise<number> {
  const { command, args } = parseArgs(argv);
  const { flags, positionals } = parseFlags(args);
  const catalogPath = flagString(flags, "catalog", defaultCatalogPath());
  const ledgerPath = flagString(flags, "ledger", defaultLedgerPath());

  switch (command) {
    case "list": {
      const catalog = loadCatalog(catalogPath);
      for (const task of catalog.tasks) {
        const judge = task.judge ? ` judge=${task.judge.type}` : "";
        console.log(
          `${task.id}\tenabled=${task.enabled}\tbaseline=${task.baseline.included}${judge}\t${task.title}`,
        );
      }
      return 0;
    }
    case "validate": {
      const catalog = loadCatalog(catalogPath);
      validateCatalog(catalog);
      const stats = catalogStats(catalog);
      console.log(
        `valid: ${stats.total} tasks (${stats.enabled} enabled, ${stats.disabled} disabled, ${stats.baseline} baseline, ${stats.judged} judged)`,
      );
      return 0;
    }
    case "run": {
      if (positionals.length !== 1) {
        throw new Error("run requires exactly one task id");
      }
      const catalog = loadCatalog(catalogPath);
      const task = findTask(catalog, positionals[0]!);
      if (!task) throw new Error(`task ${positionals[0]} not found`);
      const judgeMode = flagString(flags, "judge", "auto");
      const judgeThreshold = Number.parseFloat(
        flagString(flags, "judge-threshold", "0"),
      );
      const { judge, threshold } = resolveJudge(judgeMode, judgeThreshold);
      const result = await runTask(task, {
        ledgerPath,
        keep: flagBoolean(flags, "keep"),
        skipAction: false,
        driver: "reference-command",
        judge,
        judgeThreshold: threshold,
      });
      process.stdout.write(marshalResult(result));
      return result.status === "passed" ? 0 : 1;
    }
    case "run-agent": {
      if (positionals.length !== 1) {
        throw new Error("run-agent requires exactly one task id");
      }
      const runtime = flagString(flags, "runtime", "native") as EvalRuntime;
      const catalog = loadCatalog(catalogPath);
      const task = findTask(catalog, positionals[0]!);
      if (!task) throw new Error(`task ${positionals[0]} not found`);
      const judgeMode = flagString(flags, "judge", "auto");
      const judgeThreshold = Number.parseFloat(
        flagString(flags, "judge-threshold", "0"),
      );
      const { judge, threshold } = resolveJudge(judgeMode, judgeThreshold);
      const { result } = await runOneTask(task, {
        driver: "agent",
        runtime,
        ledgerPath,
        keep: flagBoolean(flags, "keep"),
        judge,
        judgeThreshold: threshold,
      });
      process.stdout.write(marshalResult(result));
      return result.status === "passed" ? 0 : 1;
    }
    case "run-suite": {
      const driver = flagString(flags, "driver", "reference") as EvalDriver;
      const runtime = flagString(flags, "runtime", "native") as EvalRuntime;
      const full = flagBoolean(flags, "full");
      const repetitions = flagInt(flags, "repetitions", 1);
      const experiment = flagString(flags, "experiment", "");
      const variant = flagString(flags, "variant", "");
      if ((experiment && !variant) || (!experiment && variant)) {
        throw new Error("experiment and variant must be provided together");
      }
      const judgeMode = flagString(flags, "judge", "auto");
      const judgeThreshold = Number.parseFloat(
        flagString(flags, "judge-threshold", "0"),
      );
      const catalog = loadCatalogForSuite(catalogPath);
      const summary = await runSuite({
        catalog,
        ledgerPath,
        driver,
        runtime,
        scope: full ? "full" : "baseline",
        ...(experiment && variant ? { experiment, variant } : {}),
        repetitions,
        judgeMode: judgeMode as "auto" | "on" | "off",
        judgeThreshold,
        keep: flagBoolean(flags, "keep"),
        onProgress: (event) => {
          if (event.phase === "task-done" && event.result) {
            console.log(`${event.taskId}: ${event.result.status}`);
          }
        },
      });
      if (summary.unexpected > 0 && !summary.aborted) {
        return 1;
      }
      return 0;
    }
    case "summary": {
      const summary = await summarizeLedger(ledgerPath);
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return 0;
    }
    case "compare": {
      const experiment = flagString(flags, "experiment", "");
      const baseline = flagString(flags, "baseline", "");
      const candidate = flagString(flags, "candidate", "");
      if (!experiment || !baseline || !candidate) {
        throw new Error("compare requires --experiment, --baseline, --candidate");
      }
      const baselineRuntime = flagString(flags, "baseline-runtime", "");
      const candidateRuntime = flagString(flags, "candidate-runtime", "");
      const summary = await compareLedger({
        ledgerPath,
        experiment,
        baseline,
        candidate,
        ...(baselineRuntime ? { baselineRuntime } : {}),
        ...(candidateRuntime ? { candidateRuntime } : {}),
      });
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return 0;
    }
    default:
      usage();
      throw new Error(`unknown command ${command}`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error("coding-eval:", error instanceof Error ? error.message : error);
  process.exit(1);
});
