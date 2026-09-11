import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import deepseekModels from "./assets/deepseek-models.json" with { type: "json" };

/** Codex Responses API model slug for DeepSeek (see DeepSeek Codex integration docs). */
export const CODEX_DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash" as const;

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

export function writeDeepSeekCodexHome(codexHome: string): void {
  mkdirSync(codexHome, { recursive: true });
  const modelsPath = join(codexHome, "models.json").replace(/\\/g, "/");
  writeFileSync(
    join(codexHome, "models.json"),
    `${JSON.stringify(deepseekModels, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(codexHome, "config.toml"),
    [
      `model = "${CODEX_DEFAULT_DEEPSEEK_MODEL}"`,
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
