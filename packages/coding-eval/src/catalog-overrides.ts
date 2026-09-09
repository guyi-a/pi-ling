import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  catalogStats,
  defaultCatalogPath,
  loadCatalog,
  validateCatalog,
  validateTask,
} from "./manifest.js";
import { catalogOverridesPath } from "./paths.js";
import type { BaselineSpec, Catalog, TaskSpec } from "./types.js";

export interface CatalogOverrides {
  version: 1;
  tasks: Record<
    string,
    Partial<
      Pick<TaskSpec, "enabled" | "prompt" | "disabled_reason" | "baseline">
    >
  >;
}

export type TaskOverridePatch = CatalogOverrides["tasks"][string];

export interface EffectiveCatalog {
  catalog: Catalog;
  catalogPath: string;
  overridesPath: string;
  hasOverrides: boolean;
}

function emptyOverrides(): CatalogOverrides {
  return { version: 1, tasks: {} };
}

export function loadOverrides(path: string): CatalogOverrides {
  if (!existsSync(path)) return emptyOverrides();
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as CatalogOverrides;
  if (parsed.version !== 1) {
    throw new Error("catalog overrides version must be 1");
  }
  if (!parsed.tasks || typeof parsed.tasks !== "object") {
    throw new Error("catalog overrides must contain tasks object");
  }
  return parsed;
}

function mergeTask(base: TaskSpec, patch: TaskOverridePatch): TaskSpec {
  const merged: TaskSpec = {
    ...base,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
    ...(patch.disabled_reason !== undefined
      ? { disabled_reason: patch.disabled_reason }
      : {}),
    ...(patch.baseline !== undefined
      ? { baseline: { ...base.baseline, ...patch.baseline } as BaselineSpec }
      : {}),
  };
  if (!merged.enabled && !merged.disabled_reason?.trim()) {
    merged.disabled_reason = "disabled via catalog override";
  }
  if (merged.enabled) {
    delete merged.disabled_reason;
  }
  validateTask(merged);
  return merged;
}

export function applyOverrides(
  catalog: Catalog,
  overrides: CatalogOverrides,
): Catalog {
  const tasks = catalog.tasks.map((task) => {
    const patch = overrides.tasks[task.id];
    if (!patch) return task;
    return mergeTask(task, patch);
  });
  const merged: Catalog = { version: catalog.version, tasks };
  validateCatalog(merged);
  return merged;
}

export function loadEffectiveCatalog(
  catalogPath = defaultCatalogPath(),
  overridesPath = catalogOverridesPath(),
): EffectiveCatalog {
  const base = loadCatalog(catalogPath);
  const overrides = loadOverrides(overridesPath);
  const hasOverrides = Object.keys(overrides.tasks).length > 0;
  const catalog = hasOverrides ? applyOverrides(base, overrides) : base;
  return { catalog, catalogPath, overridesPath, hasOverrides };
}

export function saveTaskOverride(
  overridesPath: string,
  catalogPath: string,
  taskId: string,
  patch: TaskOverridePatch,
): EffectiveCatalog {
  const base = loadCatalog(catalogPath);
  const baseTask = base.tasks.find((task) => task.id === taskId);
  if (!baseTask) throw new Error(`task ${taskId} not found`);

  const overrides = loadOverrides(overridesPath);
  const current = overrides.tasks[taskId] ?? {};
  const nextPatch = { ...current, ...patch };
  mergeTask(baseTask, nextPatch);

  overrides.tasks[taskId] = nextPatch;
  mkdirSync(dirname(overridesPath), { recursive: true });
  writeFileSync(
    overridesPath,
    `${JSON.stringify(overrides, null, 2)}\n`,
    "utf8",
  );
  return loadEffectiveCatalog(catalogPath, overridesPath);
}

export function clearTaskOverride(
  overridesPath: string,
  catalogPath: string,
  taskId: string,
): EffectiveCatalog {
  const overrides = loadOverrides(overridesPath);
  delete overrides.tasks[taskId];
  if (Object.keys(overrides.tasks).length === 0) {
    if (existsSync(overridesPath)) {
      writeFileSync(overridesPath, `${JSON.stringify(emptyOverrides(), null, 2)}\n`, "utf8");
    }
  } else {
    writeFileSync(
      overridesPath,
      `${JSON.stringify(overrides, null, 2)}\n`,
      "utf8",
    );
  }
  return loadEffectiveCatalog(catalogPath, overridesPath);
}

export { catalogStats };
