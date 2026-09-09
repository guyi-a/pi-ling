import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { LedgerSummary, RunResult } from "./types.js";

export async function appendLedger(
  path: string,
  result: RunResult,
): Promise<void> {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(result)}\n`, "utf8");
}

export async function readLedger(path: string): Promise<RunResult[]> {
  const raw = await readFile(path, "utf8");
  const results: RunResult[] = [];
  const lines = raw.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      results.push(JSON.parse(line) as RunResult);
    } catch (error) {
      throw new Error(
        `ledger line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return results;
}

export async function summarizeLedger(path: string): Promise<LedgerSummary> {
  const results = await readLedger(path);
  const summary: LedgerSummary = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    errors: 0,
  };
  for (const result of results) {
    summary.total += 1;
    switch (result.status) {
      case "passed":
        summary.passed += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      case "skipped":
        summary.skipped += 1;
        break;
      default:
        summary.errors += 1;
        break;
    }
  }
  return summary;
}
