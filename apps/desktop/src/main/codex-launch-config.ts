import { existsSync } from "node:fs";
import { join, resolve } from "node:path";



import type { CodexRuntimeOptions } from "@pi-ling/codex-runtime";
import { isProviderSupportedByRuntime } from "@pi-ling/llm-config";

import {

  CODEX_DEFAULT_DEEPSEEK_MODEL,

  resolveBundledCodexBin,

  writeDeepSeekCodexHome,

} from "@pi-ling/codex-runtime";



export const PINNED_CODEX_SDK_VERSION = "0.154.0";



export type CodexLaunchResolution =

  | { enabled: false }

  | { enabled: true; reason: string }

  | {

      enabled: true;

      options: CodexRuntimeOptions;

    };



export function resolveCodexLaunchConfig(

  env: NodeJS.ProcessEnv,

  userDataPath: string,

  repoRoot?: string,

): CodexLaunchResolution {

  if (env["PI_LING_CODEX_ENABLED"] !== "true") {

    return { enabled: false };

  }



  const provider = env["PI_LING_PROVIDER"]?.trim() || "deepseek";
  const model = env["PI_LING_MODEL"]?.trim() || CODEX_DEFAULT_DEEPSEEK_MODEL;
  if (!isProviderSupportedByRuntime(provider, "codex")) {
    return {
      enabled: true,
      reason: `Codex does not support provider "${provider}". Use DeepSeek in settings.`,
    };
  }

  if (!env["DEEPSEEK_API_KEY"]?.trim()) {
    return {
      enabled: true,
      reason:
        "PI_LING_CODEX_ENABLED=true requires a DeepSeek API key in settings or .env",
    };
  }

  const codexHome = resolve(
    env["PI_LING_CODEX_HOME"]?.trim() || join(userDataPath, "codex"),
  );
  writeDeepSeekCodexHome(codexHome, model);



  const configuredBin = env["PI_LING_CODEX_BIN"]?.trim();

  const codexBin = configuredBin

    ? resolve(configuredBin)

    : resolveBundledCodexBin(

        repoRoot ? { searchRoots: [repoRoot] } : {},

      );



  if (!codexBin || !existsSync(codexBin)) {

    return {

      enabled: true,

      reason: configuredBin

        ? `Codex executable does not exist: ${resolve(configuredBin)}`

        : "Codex binary not found. Run `pnpm install` or set PI_LING_CODEX_BIN in .env",

    };

  }



  return {

    enabled: true,

    options: {

      codexHome,

      codexBin,

      model,

      env: {

        DEEPSEEK_API_KEY: env["DEEPSEEK_API_KEY"]!,

        CODEX_HOME: codexHome,

        ...(env["DEEPSEEK_BASE_URL"]?.trim()

          ? { DEEPSEEK_BASE_URL: env["DEEPSEEK_BASE_URL"] }

          : {}),

      },

    },

  };

}

