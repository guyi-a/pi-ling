import type { AgentUsage } from "@pi-ling/contracts";

/**
 * 一次模型调用的用量，来自 Codex 的 `tokenUsage.last`。
 *
 * 为什么是 `last` 而不是 `total`：`total` 是整个 thread 的累计，会单调增长到
 * 远超模型窗口（曾因此把「会话累计消耗」当成「当前上下文占用」，footer 显示
 * 出 1.4m 这种不可能的输入量）。`last` 与 Native 的每调用用量同粒度。
 */
export interface CodexCallUsage {
  input: number;
  output: number;
  reasoning: number;
}

/** 协议是否提供了可用的逐次用量。ACP 只给 used/size，因此可能没有。 */
export function hasCallUsage(usage: CodexCallUsage): boolean {
  return usage.input > 0 || usage.output > 0;
}

/**
 * 映射为 `AgentUsage`，字段与 Native 侧保持同一语义：
 * `input`/`output` 是**这一次调用**的量，而不是会话累计。
 */
export function toAgentUsage(usage: CodexCallUsage | undefined): AgentUsage {
  if (!usage) {
    return { input: 0, output: 0, totalTokens: 0, cost: 0 };
  }
  return {
    input: usage.input,
    output: usage.output,
    totalTokens: usage.input + usage.output,
    cost: 0,
    ...(usage.reasoning > 0 ? { reasoning: usage.reasoning } : {}),
  };
}
