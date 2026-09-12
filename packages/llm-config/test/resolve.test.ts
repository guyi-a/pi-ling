import { describe, expect, it } from "vitest";

import {
  applyLlmConfigToProcessEnv,
  isLlmConfigured,
  resolveLlmConfig,
} from "../src/resolve.js";

describe("resolveLlmConfig", () => {
  it("defaults to deepseek-flash", () => {
    const config = resolveLlmConfig(undefined, {});
    expect(config.provider).toBe("deepseek");
    expect(config.model).toBe("deepseek-flash");
    expect(isLlmConfigured(config)).toBe(false);
  });

  it("reads saved provider, model, and api key", () => {
    const config = resolveLlmConfig(
      {
        provider: "zai",
        model: "glm-5.2",
        apiKey: "zai-key",
      },
      {},
    );
    expect(config.provider).toBe("zai");
    expect(config.model).toBe("glm-5.2");
    expect(config.apiKey).toBe("zai-key");
    expect(isLlmConfigured(config)).toBe(true);
  });

  it("falls back to env vars", () => {
    const config = resolveLlmConfig(undefined, {
      PI_LING_PROVIDER: "anthropic",
      PI_LING_MODEL: "claude-opus-4-6",
      ANTHROPIC_API_KEY: "anthropic-secret",
    });
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-opus-4-6");
    expect(config.apiKey).toBe("anthropic-secret");
  });
});

describe("applyLlmConfigToProcessEnv", () => {
  it("writes provider env keys", () => {
    const env: NodeJS.ProcessEnv = {};
    applyLlmConfigToProcessEnv(
      resolveLlmConfig(
        {
          provider: "deepseek",
          model: "deepseek-flash",
          apiKey: "ds-key",
          baseUrl: "https://api.deepseek.com",
        },
        env,
      ),
      env,
    );
    expect(env.PI_LING_PROVIDER).toBe("deepseek");
    expect(env.PI_LING_MODEL).toBe("deepseek-flash");
    expect(env.DEEPSEEK_API_KEY).toBe("ds-key");
    expect(env.DEEPSEEK_BASE_URL).toBe("https://api.deepseek.com");
  });
});
