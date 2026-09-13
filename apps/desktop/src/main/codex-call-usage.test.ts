import { describe, expect, it } from "vitest";

import { hasCallUsage, toAgentUsage } from "./codex-call-usage.js";

describe("hasCallUsage", () => {
  it("is false when the protocol reported nothing", () => {
    expect(hasCallUsage({ input: 0, output: 0, reasoning: 0 })).toBe(false);
  });

  it("is true when either side has tokens", () => {
    expect(hasCallUsage({ input: 200, output: 0, reasoning: 0 })).toBe(true);
    expect(hasCallUsage({ input: 0, output: 300, reasoning: 0 })).toBe(true);
  });
});

describe("toAgentUsage", () => {
  it("maps one call's tokens, matching Native's field semantics", () => {
    // 与 Native 的 AgentUsage 同构：input/output 是「这一次调用」的量，
    // 不是会话累计。totalTokens 为该次调用的 input + output。
    expect(toAgentUsage({ input: 200, output: 300, reasoning: 0 })).toEqual({
      input: 200,
      output: 300,
      totalTokens: 500,
      cost: 0,
    });
  });

  it("includes reasoning only when present", () => {
    expect(toAgentUsage({ input: 10, output: 5, reasoning: 0 })).not.toHaveProperty(
      "reasoning",
    );
    expect(toAgentUsage({ input: 10, output: 5, reasoning: 42 })).toMatchObject({
      reasoning: 42,
    });
  });

  it("falls back to zeros when no per-call usage exists", () => {
    expect(toAgentUsage(undefined)).toEqual({
      input: 0,
      output: 0,
      totalTokens: 0,
      cost: 0,
    });
  });

  it("does not carry cumulative-thread numbers", () => {
    // 回归防护：曾经把 Codex 的 `total`（thread 累计）当成一次调用的用量，
    // 导致 footer 显示远超模型窗口的输入量。这里锁住「逐次」语义：
    // 一次调用 300 输出，就不能出现 30000 这种累计值。
    const usage = toAgentUsage({ input: 200, output: 300, reasoning: 0 });
    expect(usage.totalTokens).toBe(500);
    expect(usage.totalTokens).toBeLessThan(1_000);
  });
});
