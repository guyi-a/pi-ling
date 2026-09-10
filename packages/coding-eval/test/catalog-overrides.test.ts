import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyOverrides,
  loadEffectiveCatalog,
  saveTaskOverride,
} from "../src/catalog-overrides.js";
import { defaultCatalogPath, loadCatalog } from "../src/manifest.js";

describe("catalog-overrides", () => {
  it("merges enabled and prompt overrides with validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coding-eval-overrides-"));
    const overridesPath = join(dir, "catalog.overrides.json");
    const catalogPath = defaultCatalogPath();
    const base = loadCatalog(catalogPath);
    const taskId = base.tasks[0]!.id;
    const effective = saveTaskOverride(overridesPath, catalogPath, taskId, {
      prompt: "override prompt for testing only",
    });
    expect(effective.hasOverrides).toBe(true);
    const task = effective.catalog.tasks.find((row) => row.id === taskId);
    expect(task?.prompt).toBe("override prompt for testing only");
    const loaded = loadEffectiveCatalog(catalogPath, overridesPath);
    expect(loaded.catalog.tasks.find((row) => row.id === taskId)?.prompt).toBe(
      "override prompt for testing only",
    );
    await rm(dir, { recursive: true, force: true });
  });

  it("auto-removes baseline when disabling a baseline task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coding-eval-overrides-"));
    const overridesPath = join(dir, "catalog.overrides.json");
    const catalogPath = defaultCatalogPath();
    const base = loadCatalog(catalogPath);
    const taskId = base.tasks.find((task) => task.baseline.included)!.id;
    const effective = saveTaskOverride(overridesPath, catalogPath, taskId, {
      enabled: false,
    });
    const task = effective.catalog.tasks.find((row) => row.id === taskId);
    expect(task?.enabled).toBe(false);
    expect(task?.baseline.included).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects invalid override patches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "coding-eval-overrides-"));
    const overridesPath = join(dir, "catalog.overrides.json");
    const catalogPath = defaultCatalogPath();
    const base = loadCatalog(catalogPath);
    const taskId = base.tasks[0]!.id;
    expect(() =>
      saveTaskOverride(overridesPath, catalogPath, taskId, {
        enabled: false,
        disabled_reason: "disabled for test",
        baseline: { included: false, reason: "disabled for test" },
      }),
    ).not.toThrow();
    await rm(dir, { recursive: true, force: true });
  });

  it("loads empty overrides when file is missing", () => {
    const effective = loadEffectiveCatalog(
      defaultCatalogPath(),
      join(tmpdir(), "missing-overrides.json"),
    );
    expect(effective.hasOverrides).toBe(false);
    expect(effective.catalog.tasks.length).toBeGreaterThan(0);
  });
});
