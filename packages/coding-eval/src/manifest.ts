import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Catalog, TaskSpec } from "./types.js";

const packageRoot = dirname(fileURLToPath(import.meta.url));

const BUILTIN_SMOKE_PROMPTS: Record<string, string> = {
  "smoke-write-greeting":
    "Create greeting.txt containing exactly: hello coding eval followed by a newline. Do not modify other files.",
  "smoke-replace-config":
    "In app.conf change only mode=dev to mode=test. Preserve the port and do not modify keep.txt.",
  "smoke-add-go-function":
    "Add the function `func Answer() int { return 42 }` to answer.go, then run `go test ./...` to verify. Do not run any other shell commands or modify other files.",
  "smoke-fix-typo":
    "Fix the typo quik to quick in message.txt and preserve the second line unchanged.",
  "smoke-json-setting":
    "Change settings.json enabled from false to true while preserving name=fixture and valid JSON.",
  "smoke-markdown-heading":
    "Prepend a level-one Markdown heading '# Notes', then one blank line, to notes.md. Preserve the existing note.",
  "smoke-generate-output":
    "Create output.txt from input.txt with every lowercase letter converted to uppercase. Do not modify input.txt.",
  "smoke-delete-obsolete":
    "Delete obsolete.txt and do not modify current.txt or any other file.",
  "smoke-nested-file":
    "Change src/pkg/value.txt from old to new. Do not modify src/other/value.txt.",
  "smoke-unicode-content":
    "Replace message.txt content with exactly '你好，Coding Alpha' followed by a newline, preserving UTF-8.",
};

const DIFFICULTIES = new Set(["smoke", "medium", "hard"]);

export function defaultCatalogPath(): string {
  const candidates = [
    join(packageRoot, "..", "catalog", "catalog.json"),
    join(packageRoot, "catalog", "catalog.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

export function loadCatalog(path = defaultCatalogPath()): Catalog {
  const raw = readFileSync(path, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  validateCatalog(catalog);
  return catalog;
}

export function findTask(catalog: Catalog, id: string): TaskSpec | undefined {
  return catalog.tasks.find((task) => task.id === id);
}

export function effectivePrompt(task: TaskSpec): string {
  const explicit = task.prompt?.trim();
  if (explicit) return explicit;
  const builtin = BUILTIN_SMOKE_PROMPTS[task.id];
  if (builtin) return builtin;
  return task.description.trim();
}

export function validateCatalog(catalog: Catalog): void {
  if (catalog.version !== 1) {
    throw new Error("catalog version must be 1");
  }
  if (catalog.tasks.length === 0) {
    throw new Error("catalog must contain tasks");
  }
  const seen = new Set<string>();
  catalog.tasks.forEach((task, index) => {
    validateTask(task);
    if (seen.has(task.id)) {
      throw new Error(`duplicate task id ${task.id}`);
    }
    seen.add(task.id);
    void index;
  });
}

export function validateTask(task: TaskSpec): void {
  if (!task.id.trim() || !task.title.trim() || !task.description.trim()) {
    throw new Error(`${task.id || "task"}: id, title, and description are required`);
  }
  if (task.type !== "fixture") {
    throw new Error(`${task.id}: unsupported type ${task.type}`);
  }
  if (task.difficulty && !DIFFICULTIES.has(task.difficulty)) {
    throw new Error(`${task.id}: unsupported difficulty ${task.difficulty}`);
  }
  if (task.judge) {
    validateJudgeSpec(task.id, task.judge);
  }
  const disabledReason = task.disabled_reason?.trim() ?? "";
  if (task.enabled === Boolean(disabledReason)) {
    throw new Error(`${task.id}: disabled_reason must be present exactly when disabled`);
  }
  if (!task.baseline.reason.trim()) {
    throw new Error(`${task.id}: baseline.reason is required`);
  }
  if (task.baseline.included && !task.enabled) {
    throw new Error(`${task.id}: disabled task cannot be included in baseline`);
  }
  if (task.timeout_seconds < 1 || task.timeout_seconds > 600) {
    throw new Error(`${task.id}: timeout_seconds must be in [1,600]`);
  }
  if (
    Object.keys(task.fixture.files).length === 0 ||
    !task.fixture.command.trim()
  ) {
    throw new Error(`${task.id}: fixture files and command are required`);
  }
  for (const name of Object.keys(task.fixture.files)) {
    validateRelativePath(name, `${task.id}: fixture file`);
  }
  if (task.verify.length === 0) {
    throw new Error(`${task.id}: at least one verify command is required`);
  }
  for (const [index, verify] of task.verify.entries()) {
    if (!verify.name.trim() || !verify.command.trim()) {
      throw new Error(`${task.id}: verify[${index}] name and command are required`);
    }
  }
  if (
    task.scoring.max_changed_files < 1 ||
    task.scoring.max_added_lines < 0 ||
    task.scoring.max_deleted_lines < 0
  ) {
    throw new Error(`${task.id}: invalid scoring limits`);
  }
  for (const pattern of task.scoring.forbidden_paths) {
    validateRelativePath(pattern.replace(/\/\*\*$/, ""), `${task.id}: forbidden path`);
  }
}

function validateJudgeSpec(taskId: string, judge: TaskSpec["judge"]): void {
  if (!judge) return;
  if (judge.type !== "llm") {
    throw new Error(`${taskId}: unsupported judge type ${judge.type}`);
  }
  if (!judge.rubric.trim()) {
    throw new Error(`${taskId}: judge rubric is required`);
  }
  if (judge.target === "response") return;
  if (judge.target.startsWith("file:")) {
    const path = judge.target.slice("file:".length).trim();
    validateRelativePath(path, `${taskId}: judge target file`);
    return;
  }
  throw new Error(`${taskId}: judge target must be "response" or "file:<path>"`);
}

function validateRelativePath(name: string, label: string): void {
  const normalized = name.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new Error(`${label} ${name}: must be a safe relative path`);
  }
}

export function catalogStats(catalog: Catalog): {
  total: number;
  enabled: number;
  disabled: number;
  baseline: number;
  judged: number;
} {
  let enabled = 0;
  let baseline = 0;
  let judged = 0;
  for (const task of catalog.tasks) {
    if (task.enabled) enabled += 1;
    if (task.enabled && task.baseline.included) baseline += 1;
    if (task.judge) judged += 1;
  }
  return {
    total: catalog.tasks.length,
    enabled,
    disabled: catalog.tasks.length - enabled,
    baseline,
    judged,
  };
}
