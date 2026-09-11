import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  DSH_PI_AI_PROFILE_PATCH,
  resolveDshNodeExecutable,
  type DshRuntimeOptions,
} from "@pi-ling/dsh-runtime";

import { loadDotenv } from "../env.js";
import { resolveEvalDataDir, resolveRepoRoot } from "../paths.js";

export function resolveProjectRoot(): string {
  return resolveRepoRoot();
}

export function resolveDshNodeCommand(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveDshNodeExecutable(env, process.execPath);
}

export function defaultDshEvalHome(): string {
  return join(resolveEvalDataDir(), "dsh-home");
}

export function buildDshRuntimeOptions(dshHome: string): DshRuntimeOptions {
  loadDotenv(resolveProjectRoot());
  const projectRoot = resolveProjectRoot();
  const sourceRoot =
    process.env["PI_LING_DSH_WORKTREE"]?.trim() ||
    join(projectRoot, ".dsh-source");
  const dshBin =
    process.env["PI_LING_DSH_BIN"]?.trim() ||
    join(sourceRoot, "apps", "cli", "lib", "bin.js");
  const command = resolveDshNodeCommand();
  const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error("DSH eval requires DEEPSEEK_API_KEY");
  }
  if (!existsSync(dshBin)) {
    throw new Error(`DSH binary not found: ${dshBin}`);
  }
  return {
    dshBin: resolve(dshBin),
    command,
    dshHome,
    cwd: sourceRoot,
    profilePatch: DSH_PI_AI_PROFILE_PATCH,
    env: {
      DEEPSEEK_API_KEY: apiKey,
      ...(process.env["DEEPSEEK_BASE_URL"]
        ? { DEEPSEEK_BASE_URL: process.env["DEEPSEEK_BASE_URL"] }
        : {}),
    },
  };
}

export function dshEvalAvailable(): boolean {
  try {
    buildDshRuntimeOptions(defaultDshEvalHome());
    return true;
  } catch {
    return false;
  }
}
