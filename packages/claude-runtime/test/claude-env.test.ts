import { describe, expect, it } from "vitest";

import {
  buildClaudeSubprocessEnv,
  detectClaudeModelBackend,
  isClaudeRuntimeConfigured,
} from "../src/claude-env.js";

describe("claude env", () => {
  it("prefers DeepSeek when both keys exist", () => {
    expect(
      detectClaudeModelBackend({
        DEEPSEEK_API_KEY: "ds-key",
        ANTHROPIC_API_KEY: "anth-key",
      }),
    ).toBe("deepseek");
  });

  it("builds DeepSeek Anthropic-compatible subprocess env", () => {
    const env = buildClaudeSubprocessEnv({
      DEEPSEEK_API_KEY: "ds-key",
      ANTHROPIC_BASE_URL: "https://gateway.example",
      ANTHROPIC_AUTH_TOKEN: "stale-token",
      ANTHROPIC_MODEL: "claude-sonnet-5",
      PATH: "C:\\Windows",
    });
    expect(env["ANTHROPIC_BASE_URL"]).toBe("https://api.deepseek.com/anthropic");
    expect(env["ANTHROPIC_AUTH_TOKEN"]).toBe("ds-key");
    expect(env["ANTHROPIC_MODEL"]).toBe("deepseek-v4-pro[1m]");
    expect(env["CLAUDE_CODE_SUBAGENT_MODEL"]).toBe("deepseek-v4-flash");
    expect(env["CLAUDE_CODE_EFFORT_LEVEL"]).toBe("max");
    expect(env["PATH"]).toBe("C:\\Windows");
  });

  it("honors DEEPSEEK_MODEL over shell ANTHROPIC_MODEL", () => {
    const env = buildClaudeSubprocessEnv({
      DEEPSEEK_API_KEY: "ds-key",
      DEEPSEEK_MODEL: "deepseek-v4-flash",
      ANTHROPIC_MODEL: "claude-sonnet-5",
    });
    expect(env["ANTHROPIC_MODEL"]).toBe("deepseek-v4-flash");
    expect(env["ANTHROPIC_DEFAULT_SONNET_MODEL"]).toBe("deepseek-v4-flash");
  });

  it("reports configured when a supported key exists", () => {
    expect(isClaudeRuntimeConfigured({ ANTHROPIC_API_KEY: "anth-key" })).toBe(
      true,
    );
    expect(isClaudeRuntimeConfigured({})).toBe(false);
  });
});
