import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  CODEX_DEFAULT_DEEPSEEK_MODEL,
  preferAsarUnpackedPath,
  resolveBundledCodexBin,
  writeDeepSeekCodexHome,
  type CodexRuntimeOptions,
} from "@pi-ling/codex-runtime";

import { loadDotenv } from "../env.js";
import { resolveEvalDataDir, resolveRepoRoot } from "../paths.js";

export function buildCodexRuntimeOptions(codexHome: string): CodexRuntimeOptions {
  loadDotenv(resolveRepoRoot());
  const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error("Codex eval requires DEEPSEEK_API_KEY");
  }

  writeDeepSeekCodexHome(codexHome);

  const configuredBin = process.env["PI_LING_CODEX_BIN"]?.trim();
  const resolvedBin = configuredBin
    ? resolve(configuredBin)
    : resolveBundledCodexBin();
  const codexBin = resolvedBin
    ? preferAsarUnpackedPath(resolvedBin)
    : undefined;
  if (!codexBin || !existsSync(codexBin)) {
    throw new Error(
      configuredBin
        ? `Codex binary not found: ${resolve(configuredBin)}`
        : "Codex binary not found. Run pnpm install or set PI_LING_CODEX_BIN",
    );
  }

  return {
    codexHome,
    codexBin,
    model: CODEX_DEFAULT_DEEPSEEK_MODEL,
    env: {
      DEEPSEEK_API_KEY: apiKey,
      CODEX_HOME: codexHome,
      ...(process.env["DEEPSEEK_BASE_URL"]?.trim()
        ? { DEEPSEEK_BASE_URL: process.env["DEEPSEEK_BASE_URL"] }
        : {}),
    },
  };
}

export function defaultCodexEvalHome(): string {
  return join(resolveEvalDataDir(), "codex-home");
}

export function codexEvalAvailable(): boolean {
  try {
    buildCodexRuntimeOptions(defaultCodexEvalHome());
    return true;
  } catch {
    return false;
  }
}
