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
    model: deepseek-v4-pro
    compaction:
      enabled: false
`.trimStart();
