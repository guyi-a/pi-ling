import type { AgentUsage } from "@pi-ling/contracts";

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return millions >= 10
      ? `${Math.round(millions)}m`
      : `${millions.toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return thousands >= 10
      ? `${Math.round(thousands)}k`
      : `${thousands.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(value);
}

function formatUsageCount(value: number): string {
  return value >= 1_000 ? formatTokenCount(value) : String(value);
}

export function fullPromptTokens(usage: AgentUsage): number {
  if (usage.totalTokens > usage.output) {
    return usage.totalTokens - usage.output;
  }
  return Math.max(usage.input, 0);
}

export function formatContextUsage(usage: {
  used: number;
  size: number;
}): string {
  if (usage.size > 0) {
    return `${formatTokenCount(usage.used)} / ${formatTokenCount(usage.size)} 上下文`;
  }
  return `${formatTokenCount(usage.used)} 上下文`;
}

export function formatMessageUsage(input: {
  usage?: AgentUsage | null;
  contextUsage?: { used: number; size: number } | null;
}): string | null {
  const output = input.usage?.output ?? 0;
  const fullInput =
    input.contextUsage?.used ??
    (input.usage ? fullPromptTokens(input.usage) : 0);
  const parts: string[] = [];
  if (fullInput > 0) {
    parts.push(`${formatUsageCount(fullInput)} 输入`);
  }
  if (output > 0) {
    parts.push(`${formatUsageCount(output)} 输出`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
