import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { DshRuntimeOptions } from "@pi-ling/dsh-runtime";

import { loadDotenv } from "../env.js";
import { resolveRepoRoot } from "../paths.js";

export function resolveProjectRoot(): string {
  return resolveRepoRoot();
}

export function resolveDshNodeCommand(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env["PI_LING_NODE_BIN"]?.trim();
  if (configured) return configured;
  return process.versions.electron ? "node" : process.execPath;
}

export function buildDshRuntimeOptions(dshHome: string): DshRuntimeOptions {
  loadDotenv(resolveProjectRoot());
  const projectRoot = resolveProjectRoot();
  const sourceRoot =
    process.env["PI_LING_DSH_WORKTREE"] ??
    join(projectRoot, ".dsh-source");
  const dshBin =
    process.env["PI_LING_DSH_BIN"] ??
    join(sourceRoot, "apps", "cli", "lib", "bin.js");
  const command = resolveDshNodeCommand();
  const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error("DSH eval requires DEEPSEEK_API_KEY");
  }
  if (!existsSync(dshBin)) {
    throw new Error(`DSH binary not found: ${dshBin}`);
  }
  const profilePatch = readFileSync(
    join(projectRoot, "apps", "desktop", "src", "main", "dsh-pi-ai-profile.ts"),
    "utf8",
  ).match(
    /export const DSH_PI_AI_PROFILE_PATCH = `([\s\S]*?)`(?:;|\.trimStart\(\);)/,
  )?.[1];
  if (!profilePatch) {
    throw new Error("DSH profile patch not found");
  }
  return {
    dshBin,
    command,
    dshHome,
    cwd: sourceRoot,
    profilePatch,
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
    buildDshRuntimeOptions(join(resolveProjectRoot(), ".coding-eval-dsh-probe"));
    return true;
  } catch {
    return false;
  }
}
