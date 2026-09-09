import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getRunResults,
  listSuiteRuns,
  suggestComparePair,
} from "../src/ledger-runs.js";
import type { RunResult } from "../src/types.js";

function sampleResult(
  overrides: Partial<RunResult> & Pick<RunResult, "task_id">,
): RunResult {
  return {
    title: overrides.task_id,
    driver: "reference-command",
    started_at: "2026-01-01T00:00:00.000Z",
    duration_ms: 10,
    status: "passed",
    action: { name: "action", command: "", exit_code: 0, duration_ms: 1 },
    verification: [],
    score: {
      passed: true,
      violations: [],
      diff: {
        changed_files: 1,
        added_lines: 1,
        deleted_lines: 0,
        paths: ["a.txt"],
      },
    },
    ...overrides,
  };
}

describe("ledger-runs", () => {
  it("groups tagged and untagged runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coding-eval-runs-"));
    const ledgerPath = join(dir, "ledger.jsonl");
    const rows = [
      sampleResult({
        task_id: "a",
        experiment_run: {
          experiment: "eval-panel",
          variant: "ref-1",
          iteration: 1,
        },
        started_at: "2026-01-02T00:00:00.000Z",
      }),
      sampleResult({
        task_id: "b",
        experiment_run: {
          experiment: "eval-panel",
          variant: "ref-1",
          iteration: 1,
        },
        started_at: "2026-01-02T00:00:01.000Z",
      }),
      sampleResult({
        task_id: "a",
        started_at: "2026-01-01T00:00:00.000Z",
      }),
    ];
    await writeFile(
      ledgerPath,
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf8",
    );
    const runs = await listSuiteRuns(ledgerPath);
    expect(runs).toHaveLength(2);
    expect(runs[0]?.variant).toBe("ref-1");
    expect(runs[0]?.total).toBe(2);
    const legacy = runs.find((run) => run.variant === "untagged");
    expect(legacy?.experiment).toBe("_legacy");
    const tagged = await getRunResults(ledgerPath, "eval-panel", "ref-1");
    expect(tagged).toHaveLength(2);
    await rm(dir, { recursive: true, force: true });
  });

  it("suggests compare pairs from recent runs", () => {
    const suggestion = suggestComparePair([
      {
        experiment: "eval-panel",
        variant: "agent-2",
        driver: "agent",
        runtime: "native",
        startedAt: "2026-01-03T00:00:00.000Z",
        finishedAt: "2026-01-03T00:00:10.000Z",
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        errors: 0,
      },
      {
        experiment: "eval-panel",
        variant: "agent-1",
        driver: "agent",
        runtime: "native",
        startedAt: "2026-01-02T00:00:00.000Z",
        finishedAt: "2026-01-02T00:00:10.000Z",
        total: 2,
        passed: 2,
        failed: 0,
        skipped: 0,
        errors: 0,
      },
    ]);
    expect(suggestion?.baselineVariant).toBe("agent-1");
    expect(suggestion?.candidateVariant).toBe("agent-2");
  });
});
