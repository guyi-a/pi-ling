import type { RuntimeKind } from "@pi-ling/contracts";

export interface LlmProviderDefinition {
  id: string;
  label: string;
  apiKeyEnv: string;
  baseUrlEnv?: string;
  /** Shown in settings placeholder; not written unless user saves a value. */
  defaultBaseUrl?: string;
  defaultModel: string;
  supportedRuntimes: RuntimeKind[];
}

/** Curated providers exposed in pi-ling settings (subset of pi-ai catalog). */
export const LLM_PROVIDER_CATALOG: readonly LlmProviderDefinition[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-flash",
    supportedRuntimes: ["native", "codex", "dsh"],
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-6",
    supportedRuntimes: ["native", "dsh"],
  },
  {
    id: "minimax",
    label: "MiniMax",
    apiKeyEnv: "MINIMAX_API_KEY",
    defaultModel: "MiniMax-M3",
    supportedRuntimes: ["native"],
  },
  {
    id: "moonshotai",
    label: "Moonshot (Kimi)",
    apiKeyEnv: "MOONSHOT_API_KEY",
    baseUrlEnv: "MOONSHOT_BASE_URL",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2-0905-preview",
    supportedRuntimes: ["native"],
  },
  {
    id: "kimi-coding",
    label: "Kimi For Coding",
    apiKeyEnv: "KIMI_API_KEY",
    defaultModel: "kimi-for-coding",
    supportedRuntimes: ["native"],
  },
  {
    id: "zai",
    label: "Z.AI (GLM Coding)",
    apiKeyEnv: "ZAI_API_KEY",
    defaultModel: "glm-5.2",
    supportedRuntimes: ["native"],
  },
] as const;

export function getLlmProviderDefinition(
  providerId: string,
): LlmProviderDefinition | undefined {
  return LLM_PROVIDER_CATALOG.find((entry) => entry.id === providerId);
}

export function defaultLlmProvider(): LlmProviderDefinition {
  return LLM_PROVIDER_CATALOG[0]!;
}

export function isProviderSupportedByRuntime(
  providerId: string,
  runtime: RuntimeKind,
): boolean {
  const definition = getLlmProviderDefinition(providerId);
  return definition?.supportedRuntimes.includes(runtime) ?? false;
}
