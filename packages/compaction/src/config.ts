import type { CompactionConfig } from "./types.js";

function envInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export function defaultCompactionConfig(): CompactionConfig {
  const apiKey =
    process.env.COMPACTION_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    "";
  return {
    enabled: envBool("COMPACTION_ENABLED", Boolean(apiKey)),
    windowNominalTokens: envInt("COMPACTION_WINDOW_TOKENS", 1_000_000),
    windowUsableRatio: envFloat("COMPACTION_WINDOW_USABLE_RATIO", 0.9),
    reservedOutputTokens: envInt("COMPACTION_RESERVED_OUTPUT_TOKENS", 32_000),
    bufferTokens: envInt("COMPACTION_BUFFER_TOKENS", 20_000),
    keepLastUserTurns: envInt("COMPACTION_KEEP_LAST_USER_TURNS", 0),
    charsPerToken: envInt("COMPACTION_CHARS_PER_TOKEN", 4),
    toolResultTruncateThresholdChars: envInt(
      "COMPACTION_TOOL_TRUNCATE_THRESHOLD",
      48_000,
    ),
    toolResultTruncateKeepChars: envInt("COMPACTION_TOOL_TRUNCATE_KEEP", 8_000),
  };
}

export function thresholdTokens(config: CompactionConfig): number {
  const raw =
    Math.floor(config.windowNominalTokens * config.windowUsableRatio) -
    config.reservedOutputTokens -
    config.bufferTokens;
  return Math.max(raw, 1024);
}

export function charsPerToken(config: CompactionConfig): number {
  return config.charsPerToken > 0 ? config.charsPerToken : 4;
}

export function compactionSummarizerEnv(): {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
} {
  return {
    apiKey:
      process.env.COMPACTION_API_KEY ??
      process.env.DEEPSEEK_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      "",
    baseUrl:
      process.env.COMPACTION_BASE_URL ??
      process.env.DEEPSEEK_BASE_URL ??
      "https://api.deepseek.com",
    model: process.env.COMPACTION_MODEL ?? "deepseek-chat",
    maxTokens: envInt("COMPACTION_MAX_TOKENS", 4096),
    timeoutMs: envInt("COMPACTION_TIMEOUT_SECONDS", 120) * 1000,
  };
}
