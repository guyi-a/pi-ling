import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compareLedger, compareTaskRows } from "../src/comparison.js";
import type { RunResult } from "../src/types.js";

describe("comparison", () => {
  it("pairs baseline and candidate observations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coding-eval-compare-"));
    const ledgerPath = join(dir, "ledger.jsonl");
    const base: RunResult = {
      task_id: "smoke-fix-typo",
      title: "Fix typo",
      driver: "reference-command",
      runtime: "native",
      experiment_run: {
        experiment: "exp1",
        variant: "baseline",
        iteration: 1,
      },
      started_at: new Date().toISOString(),
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
          deleted_lines: 1,
          paths: ["message.txt"],
        },
      },
      metrics: { tool_calls: 2, validation_calls: 1, completion_gate_runs: 0, approval_interrupts: 0 },
    };
    const candidate: RunResult = {
      ...base,
      experiment_run: {
        experiment: "exp1",
        variant: "candidate",
        iteration: 1,
      },
      status: "failed",
      metrics: { tool_calls: 4, validation_calls: 2, completion_gate_runs: 0, approval_interrupts: 0 },
    };
    await writeFile(
      ledgerPath,
      `${JSON.stringify(base)}\n${JSON.stringify(candidate)}\n`,
      "utf8",
    );
    const summary = await compareLedger({
      ledgerPath,
      experiment: "exp1",
      baseline: "baseline",
      candidate: "candidate",
    });
    expect(summary.pairs).toBe(1);
    expect(summary.baseline_pass_rate).toBe(1);
    expect(summary.candidate_pass_rate).toBe(0);
    expect(summary.pass_rate_lift).toBe(-1);
    expect(summary.metrics.tool_calls.delta).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });

  it("supports comparing a variant with itself", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coding-eval-compare-self-"));
    const ledgerPath = join(dir, "ledger.jsonl");
    const run: RunResult = {
      task_id: "smoke-fix-typo",
      title: "Fix typo",
      driver: "agent",
      runtime: "dsh",
      experiment_run: {
        experiment: "agent-dsh-20260909-202502",
        variant: "agent-dsh",
        iteration: 1,
      },
      started_at: new Date().toISOString(),
      duration_ms: 100,
      status: "passed",
      action: { name: "action", command: "", exit_code: 0, duration_ms: 1 },
      verification: [],
      score: {
        passed: true,
        violations: [],
        diff: {
          changed_files: 1,
          added_lines: 1,
          deleted_lines: 1,
          paths: ["message.txt"],
        },
      },
      metrics: {
        tool_calls: 2,
        validation_calls: 1,
        completion_gate_runs: 0,
        approval_interrupts: 0,
      },
    };
    await writeFile(ledgerPath, `${JSON.stringify(run)}\n`, "utf8");
    const summary = await compareLedger({
      ledgerPath,
      experiment: "agent-dsh-20260909-202502",
      baseline: "agent-dsh",
      candidate: "agent-dsh",
    });
    expect(summary.pairs).toBe(1);
    expect(summary.baseline_pass_rate).toBe(1);
    expect(summary.candidate_pass_rate).toBe(1);
    expect(summary.pass_rate_lift).toBe(0);
    expect(summary.metrics.duration_ms.delta).toBe(0);
    expect(summary.metrics.tool_calls.delta).toBe(0);
    const rows = compareTaskRows([run], [run]);
    expect(rows[0]?.statusChanged).toBe(false);
    expect(rows[0]?.durationDeltaMs).toBe(0);
    expect(rows[0]?.toolCallsDelta).toBe(0);
    await rm(dir, { recursive: true, force: true });
  });

  it("builds per-task comparison rows", () => {
    const baseline: RunResult = {
      task_id: "a",
      title: "Task A",
      driver: "reference-command",
      started_at: "2026-01-01T00:00:00.000Z",
      duration_ms: 100,
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
      metrics: {
        tool_calls: 1,
        validation_calls: 0,
        completion_gate_runs: 0,
        approval_interrupts: 0,
      },
    };
    const candidate: RunResult = {
      ...baseline,
      status: "failed",
      duration_ms: 150,
      metrics: {
        tool_calls: 3,
        validation_calls: 1,
        completion_gate_runs: 0,
        approval_interrupts: 0,
      },
      score: {
        ...baseline.score,
        passed: false,
        violations: ["too many files"],
      },
    };
    const rows = compareTaskRows([baseline], [candidate]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.statusChanged).toBe(true);
    expect(rows[0]?.durationDeltaMs).toBe(50);
    expect(rows[0]?.toolCallsDelta).toBe(2);
    expect(rows[0]?.violations).toEqual(["too many files"]);
  });
});
