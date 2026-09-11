import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function resolveCodingEvalPackageRoot(): string {
  return join(moduleDir, "..");
}

function bundledRepoRootCandidates(): string[] {
  const packageRoot = resolveCodingEvalPackageRoot();
  return [
    join(packageRoot, "..", ".."),
    join(packageRoot, "..", "..", "..", ".."),
    join(packageRoot, "catalog", "..", "..", ".."),
  ];
}

export function resolveRepoRoot(): string {
  const fromEnv = process.env.PI_LING_REPO_ROOT?.trim();
  if (fromEnv) return fromEnv;

  for (const candidate of bundledRepoRootCandidates()) {
    if (existsSync(join(candidate, "pnpm-workspace.yaml"))) {
      return candidate;
    }
  }

  return join(resolveCodingEvalPackageRoot(), "..", "..");
}

export function resolveEvalDataDir(): string {
  const fromEnv = process.env.PI_LING_EVAL_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(resolveRepoRoot(), ".coding-eval");
}

export function defaultLedgerPath(): string {
  return join(resolveEvalDataDir(), "ledger.jsonl");
}

export function catalogOverridesPath(): string {
  return join(resolveEvalDataDir(), "catalog.overrides.json");
}
