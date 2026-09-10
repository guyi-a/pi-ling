import { describe, expect, it } from "vitest";

import { formatMessageUsage, fullPromptTokens } from "./format-message-usage";

describe("formatMessageUsage", () => {
  it("uses full prompt tokens instead of billable input only", () => {
    expect(fullPromptTokens({ input: 144, output: 64, totalTokens: 3152, cost: 0 })).toBe(
      3088,
    );
    expect(
      formatMessageUsage({
        usage: { input: 144, output: 64, totalTokens: 3152, cost: 0 },
      }),
    ).toBe("3.1k 输入 · 64 输出");
  });

  it("formats the screenshot case with complete input and turn output", () => {
    expect(
      formatMessageUsage({
        usage: { input: 69, output: 314, totalTokens: 3500, cost: 0 },
      }),
    ).toBe("3.2k 输入 · 314 输出");
  });

  it("maps DSH context usage to complete input", () => {
    expect(
      formatMessageUsage({
        contextUsage: { used: 8700, size: 1_000_000 },
        usage: { input: 0, output: 0, totalTokens: 0, cost: 0 },
      }),
    ).toBe("8.7k 输入");
  });

  it("prefers persisted context usage over recomputed prompt tokens", () => {
    expect(
      formatMessageUsage({
        contextUsage: { used: 3088, size: 128_000 },
        usage: { input: 144, output: 64, totalTokens: 3152, cost: 0 },
      }),
    ).toBe("3.1k 输入 · 64 输出");
  });
});
