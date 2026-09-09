import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readLedger } from "../src/ledger.js";
import { loadCatalog } from "../src/manifest.js";
import { defaultCatalogPath } from "../src/manifest.js";
import { runSuite } from "../src/run-suite.js";

describe("runSuite", () => {
  it("runs baseline reference tasks with progress and experiment tags", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coding-eval-suite-"));
    const ledgerPath = join(dir, "ledger.jsonl");
    const catalog = loadCatalog(defaultCatalogPath());
    const events: string[] = [];
    const summary = await runSuite({
      catalog,
      ledgerPath,
      driver: "reference",
      runtime: "native",
      scope: "baseline",
      variant: "test-reference",
      onProgress: (event) => {
        events.push(`${event.phase}:${event.taskId}`);
      },
    });
    expect(summary.passed).toBeGreaterThan(0);
    expect(summary.variant).toBe("test-reference");
    expect(events.some((event) => event.startsWith("task-start:"))).toBe(true);
    expect(events.at(-1)).toBe("suite-done:");
    const ledger = await readLedger(ledgerPath);
    expect(ledger.every((row) => row.experiment_run?.variant === "test-reference")).toBe(
      true,
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("aborts between tasks when shouldAbort returns true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coding-eval-suite-"));
    const ledgerPath = join(dir, "ledger.jsonl");
    const catalog = loadCatalog(defaultCatalogPath());
    let started = 0;
    const summary = await runSuite({
      catalog,
      ledgerPath,
      driver: "reference",
      runtime: "native",
      scope: "baseline",
      variant: "test-abort",
      shouldAbort: () => started >= 2,
      onProgress: (event) => {
        if (event.phase === "task-start") started += 1;
      },
    });
    expect(summary.aborted).toBe(true);
    expect(summary.total).toBeLessThan(catalog.tasks.filter((t) => t.baseline.included).length);
    await rm(dir, { recursive: true, force: true });
  });
});
