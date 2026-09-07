import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { DshRuntimeOptions } from "@pi-ling/dsh-runtime";

import { DSH_PI_AI_PROFILE_PATCH } from "./dsh-pi-ai-profile.js";

export const PINNED_DSH_VERSION = "0.1.3-alpha.1";
export const PINNED_DSH_COMMIT = "d347e703";

export type DshLaunchResolution =
  | { enabled: false }
  | { enabled: true; reason: string }
  | {
      enabled: true;
      sourceRoot: string;
      options: DshRuntimeOptions;
    };

function manifestVersion(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as {
      version?: unknown;
    };
    return typeof value.version === "string" ? value.version : undefined;
  } catch {
    return undefined;
  }
}

export function resolveDshLaunchConfig(
  env: NodeJS.ProcessEnv,
  userDataPath: string,
  nodeExecutable = process.versions.electron ? "node" : process.execPath,
): DshLaunchResolution {
  if (env["PI_LING_DSH_ENABLED"] !== "true") {
    return { enabled: false };
  }

  const configuredBin = env["PI_LING_DSH_BIN"]?.trim();
  if (!configuredBin) {
    return {
      enabled: true,
      reason:
        "PI_LING_DSH_ENABLED=true requires an explicit PI_LING_DSH_BIN",
    };
  }
  const dshBin = resolve(configuredBin);
  if (!existsSync(dshBin)) {
    return {
      enabled: true,
      reason: `Pinned DSH executable does not exist: ${dshBin}`,
    };
  }

  const cliManifest = resolve(dirname(dshBin), "../package.json");
  const sourceRoot = resolve(dirname(dshBin), "../../..");
  const rootManifest = join(sourceRoot, "package.json");
  const cliVersion = manifestVersion(cliManifest);
  const rootVersion = manifestVersion(rootManifest);
  if (
    cliVersion !== PINNED_DSH_VERSION ||
    rootVersion !== PINNED_DSH_VERSION
  ) {
    return {
      enabled: true,
      reason:
        `DSH version mismatch: CLI=${cliVersion ?? "unknown"}, ` +
        `root=${rootVersion ?? "unknown"}, expected=${PINNED_DSH_VERSION}`,
    };
  }

  const configuredNode = env["PI_LING_NODE_BIN"]?.trim();
  const command = configuredNode ? resolve(configuredNode) : nodeExecutable;
  if (isAbsolute(command) && !existsSync(command)) {
    return {
      enabled: true,
      reason: `Node executable does not exist: ${command}`,
    };
  }

  return {
    enabled: true,
    sourceRoot,
    options: {
      dshBin,
      command,
      dshHome: join(
        userDataPath,
        "dsh",
        `${PINNED_DSH_VERSION}-${PINNED_DSH_COMMIT}`,
      ),
      cwd: sourceRoot,
      profilePatch: DSH_PI_AI_PROFILE_PATCH,
      env: {
        ...(env["DEEPSEEK_API_KEY"]?.trim()
          ? { DEEPSEEK_API_KEY: env["DEEPSEEK_API_KEY"] }
          : {}),
        ...(env["ANTHROPIC_API_KEY"]?.trim()
          ? { ANTHROPIC_API_KEY: env["ANTHROPIC_API_KEY"] }
          : {}),
        ...(env["DEEPSEEK_BASE_URL"]?.trim()
          ? { DEEPSEEK_BASE_URL: env["DEEPSEEK_BASE_URL"] }
          : {}),
        ...(env["ANTHROPIC_BASE_URL"]?.trim()
          ? { ANTHROPIC_BASE_URL: env["ANTHROPIC_BASE_URL"] }
          : {}),
      },
    },
  };
}
