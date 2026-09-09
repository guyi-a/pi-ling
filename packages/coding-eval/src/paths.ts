import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));

export function resolveRepoRoot(): string {
  return join(packageRoot, "..", "..");
}

export function resolveEvalDataDir(): string {
  return join(resolveRepoRoot(), ".coding-eval");
}

export function defaultLedgerPath(): string {
  return join(resolveEvalDataDir(), "ledger.jsonl");
}

export function catalogOverridesPath(): string {
  return join(resolveEvalDataDir(), "catalog.overrides.json");
}
