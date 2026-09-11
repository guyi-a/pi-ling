/** DSH uses pi-ai's built-in catalog; flash is registered at runtime only on Native. */
export const DSH_ACP_DEEPSEEK_MODEL = "deepseek-v4-pro" as const;

export const DSH_PI_AI_PROFILE_PATCH = `
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
    provider: deepseek
    model: ${DSH_ACP_DEEPSEEK_MODEL}
    compaction:
      enabled: false
`.trimStart();
