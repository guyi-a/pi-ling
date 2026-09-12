import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import deepseekModels from "./assets/deepseek-models.json" with { type: "json" };

/** Official DeepSeek V4.1 Flash slug for Codex Responses API. */
export const CODEX_DEFAULT_DEEPSEEK_MODEL = "deepseek-flash" as const;

function windowsSandboxConfigLines(): string[] {
  // Codex 0.154 on native Windows treats `--sandbox workspace-write` as read-only
  // unless a Windows sandbox backend is configured (openai/codex#34958).
  if (process.platform !== "win32") return [];
  return [
    "",
    "[windows]",
    // `unelevated` keeps shell commands working; switch to `elevated` if apply_patch updates fail.
    'sandbox = "unelevated"',
  ];
}

export function writeDeepSeekCodexHome(
  codexHome: string,
  model: string = CODEX_DEFAULT_DEEPSEEK_MODEL,
): void {
  mkdirSync(codexHome, { recursive: true });
  const modelsPath = join(codexHome, "models.json").replace(/\\/g, "/");
  const catalog = {
    models: deepseekModels.models.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            slug: model,
            display_name: "DeepSeek-V4.1-Flash",
          }
        : entry,
    ),
  };
  writeFileSync(
    join(codexHome, "models.json"),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(codexHome, "config.toml"),
    [
      `model = "${model}"`,
      'model_provider = "deepseek"',
      'preferred_auth_method = "apikey"',
      'forced_login_method = "api"',
      'model_reasoning_effort = "high"',
      `model_catalog_json = "${modelsPath}"`,
      "",
      "[model_providers.deepseek]",
      'name = "deepseek"',
      'base_url = "https://api.deepseek.com/"',
      'wire_api = "responses"',
      'env_key = "DEEPSEEK_API_KEY"',
      ...windowsSandboxConfigLines(),
      "",
    ].join("\n"),
    "utf8",
  );
}

