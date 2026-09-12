/** Default DeepSeek V4.1 Flash model id for DSH ACP. */
export const DSH_ACP_DEEPSEEK_MODEL = "deepseek-flash" as const;

/** Model id in DSH's embedded pi-ai catalog (not pi-ling's alias). */
export const DSH_PI_AI_DEEPSEEK_MODEL = "deepseek-v4-pro" as const;

export interface DshPiAiProfileOptions {
  provider?: string;
  model?: string;
}

/** Map pi-ling settings ids to ids that exist in DSH's bundled pi-ai. */
export function resolveDshAcpModel(provider: string, model: string): string {
  if (provider === "deepseek" && model === DSH_ACP_DEEPSEEK_MODEL) {
    return DSH_PI_AI_DEEPSEEK_MODEL;
  }
  return model;
}

export function buildDshPiAiProfilePatch(
  options: DshPiAiProfileOptions = {},
): string {
  const provider = options.provider ?? "deepseek";
  const model = resolveDshAcpModel(
    provider,
    options.model ?? DSH_ACP_DEEPSEEK_MODEL,
  );
  return `
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      deepseek:
        apiKeyEnv: DEEPSEEK_API_KEY
        baseURL: !!js "process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'"
        reasoning: high
      anthropic:
        apiKeyEnv: ANTHROPIC_API_KEY
        baseURL: !!js "process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'"
        reasoning: high

- id: acp
  name: '@deepseek-ai/dsh-acp'
  config:
    provider: ${provider}
    model: ${model}
    compaction:
      enabled: false
`.trimStart();
}

/** @deprecated Use buildDshPiAiProfilePatch() for configurable provider/model. */
export const DSH_PI_AI_PROFILE_PATCH = buildDshPiAiProfilePatch();
