import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DshRuntimeOptions } from "@pi-ling/dsh-runtime";

import { loadDotenv } from "../env.js";

const packageRoot = dirname(fileURLToPath(import.meta.url));

export function resolveProjectRoot(): string {
  return resolve(packageRoot, "..", "..", "..");
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
  const command = process.env["PI_LING_NODE_BIN"] ?? process.execPath;
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
  ).match(/export const DSH_PI_AI_PROFILE_PATCH = `([\s\S]*?)`;/)?.[1];
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
