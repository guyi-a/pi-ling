import type { AgentUsage } from "@pi-ling/contracts";

import type { AssistantTimelineItem } from "../../timeline/reducer";

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

/** Aggregate token usage across every model call in one user run. */
export function aggregateRunUsage(
  assistants: readonly AssistantTimelineItem[],
): {
  usage?: AgentUsage;
  contextUsage?: { used: number; size: number };
} {
  const withUsage = assistants.filter(
    (assistant) =>
      assistant.usage &&
      (assistant.usage.output > 0 || assistant.usage.totalTokens > 0),
  );
  const lastContext = [...assistants]
    .reverse()
    .find(
      (assistant) =>
        assistant.contextUsage &&
        (assistant.contextUsage.used > 0 || assistant.contextUsage.size > 0),
    )?.contextUsage;

  if (withUsage.length === 0) {
    return lastContext ? { contextUsage: lastContext } : {};
  }

  let output = 0;
  let cost = 0;
  let reasoning = 0;
  let hasReasoning = false;
  for (const assistant of withUsage) {
    const usage = assistant.usage!;
    output += usage.output;
    cost += usage.cost;
    if (usage.reasoning !== undefined) {
      reasoning += usage.reasoning;
      hasReasoning = true;
    }
  }

  const lastUsage = withUsage.at(-1)!.usage!;
  const fullInput = lastContext?.used ?? fullPromptTokens(lastUsage);

  return {
    usage: {
      input: lastUsage.input,
      output,
      totalTokens: fullInput + output,
      cost,
      ...(hasReasoning ? { reasoning } : {}),
    },
    ...(lastContext ? { contextUsage: lastContext } : {}),
  };
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
