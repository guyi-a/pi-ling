export type ClaudeModelBackend = "deepseek" | "anthropic";

const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";
/** DeepSeek Claude Code doc default (1M context variant). */
const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-pro[1m]";
const DEEPSEEK_DEFAULT_FLASH_MODEL = "deepseek-v4-flash";
const DEEPSEEK_DEFAULT_EFFORT_LEVEL = "max";
const DEEPSEEK_DEFAULT_AUTO_COMPACT_WINDOW = "786432";

export interface ClaudeRuntimeEnvOptions {
  /** Prefer DeepSeek even when both keys are present. */
  preferDeepSeek?: boolean;
  overrides?: Record<string, string>;
}

export function detectClaudeModelBackend(
  env: NodeJS.ProcessEnv = process.env,
  options?: ClaudeRuntimeEnvOptions,
): ClaudeModelBackend | undefined {
  const deepseek = env["DEEPSEEK_API_KEY"]?.trim();
  const anthropic =
    env["ANTHROPIC_API_KEY"]?.trim() ?? env["ANTHROPIC_AUTH_TOKEN"]?.trim();
  if (options?.preferDeepSeek !== false && deepseek) return "deepseek";
  if (anthropic) return "anthropic";
  if (deepseek) return "deepseek";
  return undefined;
}

export function isClaudeRuntimeConfigured(
  env: NodeJS.ProcessEnv = process.env,
  options?: ClaudeRuntimeEnvOptions,
): boolean {
  return detectClaudeModelBackend(env, options) !== undefined;
}

export function resolveDeepSeekModel(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["DEEPSEEK_MODEL"]?.trim();
  if (!configured) return DEEPSEEK_DEFAULT_MODEL;
  // Allow short alias without the doc's [1m] suffix.
  if (configured === "deepseek-v4-pro") return DEEPSEEK_DEFAULT_MODEL;
  return configured;
}

/** Model name accepted by Claude Code CLI (API backend may map it separately). */
export function resolveClaudeSdkModel(
  backend: ClaudeModelBackend,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (backend === "deepseek") {
    return env["DEEPSEEK_SDK_MODEL"]?.trim() || "claude-sonnet-4-5";
  }
  return env["ANTHROPIC_MODEL"]?.trim() || "claude-sonnet-4-5";
}

/** @deprecated Use resolveClaudeSdkModel for SDK calls. */
export function defaultClaudeModel(
  backend: ClaudeModelBackend,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveClaudeSdkModel(backend, env);
}

const DEEPSEEK_STRIPPED_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
] as const;

function stripKeys(
  source: Record<string, string>,
  keys: readonly string[],
): Record<string, string> {
  const next = { ...source };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

export function buildClaudeSubprocessEnv(
  env: NodeJS.ProcessEnv = process.env,
  options?: ClaudeRuntimeEnvOptions,
): Record<string, string> {
  const backend = detectClaudeModelBackend(env, options);
  if (!backend) {
    throw new Error(
      "Claude runtime requires DEEPSEEK_API_KEY or ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN",
    );
  }

  const base = Object.fromEntries(
    Object.entries({ ...env, ...options?.overrides }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  if (backend === "deepseek") {
    const apiKey = env["DEEPSEEK_API_KEY"]!.trim();
    const model = resolveDeepSeekModel(env);
    const rest = stripKeys(base, DEEPSEEK_STRIPPED_ENV_KEYS);
    return {
      ...rest,
      ANTHROPIC_BASE_URL:
        env["DEEPSEEK_ANTHROPIC_BASE_URL"]?.trim() ||
        DEEPSEEK_ANTHROPIC_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: DEEPSEEK_DEFAULT_FLASH_MODEL,
      CLAUDE_CODE_SUBAGENT_MODEL:
        env["CLAUDE_CODE_SUBAGENT_MODEL"]?.trim() ||
        DEEPSEEK_DEFAULT_FLASH_MODEL,
      CLAUDE_CODE_EFFORT_LEVEL:
        env["CLAUDE_CODE_EFFORT_LEVEL"]?.trim() ||
        DEEPSEEK_DEFAULT_EFFORT_LEVEL,
      CLAUDE_CODE_AUTO_COMPACT_WINDOW:
        env["CLAUDE_CODE_AUTO_COMPACT_WINDOW"]?.trim() ||
        DEEPSEEK_DEFAULT_AUTO_COMPACT_WINDOW,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    };
  }

  const merged: Record<string, string> = { ...base };
  const apiKey = env["ANTHROPIC_API_KEY"]?.trim();
  const authToken = env["ANTHROPIC_AUTH_TOKEN"]?.trim();
  if (apiKey) merged["ANTHROPIC_API_KEY"] = apiKey;
  if (authToken) merged["ANTHROPIC_AUTH_TOKEN"] = authToken;
  const baseUrl = env["ANTHROPIC_BASE_URL"]?.trim();
  if (baseUrl) merged["ANTHROPIC_BASE_URL"] = baseUrl;
  return merged;
}
