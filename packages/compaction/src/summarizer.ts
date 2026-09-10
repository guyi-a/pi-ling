import type { CompactionConfig, CompactionRow } from "./types.js";
import {
  summaryInstructions,
  triggerPrompt,
  wrapPriorSummary,
} from "./prompt.js";

export interface SummarizeChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

function truncate(value: string, config: CompactionConfig): string {
  const limit = config.toolResultTruncateThresholdChars;
  const keep = config.toolResultTruncateKeepChars;
  if (limit <= 0 || keep <= 0 || value.length <= limit || keep * 2 >= value.length) {
    return value;
  }
  const omitted = value.length - keep * 2;
  return (
    value.slice(0, keep) +
    `\n\n[... ${omitted} chars truncated for compaction ...]\n\n` +
    value.slice(value.length - keep)
  );
}

export function buildSummarizerMessages(
  folded: readonly CompactionRow[],
  priorSummary: string,
  config: CompactionConfig,
): SummarizeChatMessage[] {
  const out: SummarizeChatMessage[] = [
    { role: "system", content: summaryInstructions },
  ];
  if (priorSummary.trim()) {
    out.push({ role: "user", content: wrapPriorSummary(priorSummary) });
  }
  for (const row of folded) {
    if (row.role === "user") {
      const content = row.content.trim();
      if (content) out.push({ role: "user", content });
      continue;
    }
    if (row.role === "assistant") {
      let content = row.content;
      if (row.reasoning) {
        content = `${content}\n[reasoning]\n${row.reasoning}`;
      }
      if (row.toolCalls) {
        content = `${content}\n[tool calls] ${truncate(row.toolCalls, config)}`;
      }
      if (content.trim()) out.push({ role: "assistant", content: content.trim() });
      continue;
    }
    const name = row.toolName ?? "tool";
    out.push({
      role: "user",
      content: `[tool result: ${name}]\n${truncate(row.content, config)}`,
    });
  }
  if (out.length <= 1) return [];
  out.push({ role: "user", content: triggerPrompt });
  return out;
}

export async function summarizeWithFetch(input: {
  messages: SummarizeChatMessage[];
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const signal = input.signal
    ? AbortSignal.any([input.signal, controller.signal])
    : controller.signal;
  try {
    const response = await fetch(
      `${input.baseUrl.replace(/\/$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          max_tokens: input.maxTokens,
          stream: false,
        }),
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Compaction summarizer failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return payload.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timeout);
  }
}
