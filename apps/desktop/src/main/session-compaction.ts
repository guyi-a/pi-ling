import type { Context, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEventEnvelope } from "@pi-ling/contracts";
import {
  buildSummarizerMessages,
  buildTokenAnchorsFromEvents,
  canonicalToCompactionRows,
  defaultCompactionConfig,
  compactionSummarizerEnv,
  findLatestCompactionRecord,
  maybeCompact,
  summaryMessageForRecord,
  summarizeWithFetch,
  wrapSummary,
  type CompactionRecord,
  type CompactionRow,
} from "@pi-ling/compaction";
import {
  projectAgentMessages,
  projectRawCanonicalMessages,
} from "@pi-ling/session-events";

import type { SessionStore } from "./session-store/session-store.js";

function messageText(message: Message): string {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content;
    }
    return message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  if (message.role === "assistant" || message.role === "toolResult") {
    return message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

function toolCallsJson(message: Extract<Message, { role: "assistant" }>): string {
  return JSON.stringify(
    message.content
      .filter((block) => block.type === "toolCall")
      .map((block) => ({
        id: block.id,
        name: block.name,
        input: block.arguments,
      })),
  );
}

export function runtimeMessagesToCompactionRows(
  messages: readonly Message[],
): CompactionRow[] {
  return messages.map((message, order) => {
    const id =
      message.role === "assistant"
        ? `assistant:${order}`
        : message.role === "toolResult"
          ? `tool:${message.toolCallId}`
          : `user:${order}`;
    if (message.role === "user") {
      return { id, order, role: "user", content: messageText(message) };
    }
    if (message.role === "assistant") {
      return {
        id,
        order,
        role: "assistant",
        content: messageText(message),
        toolCalls: toolCallsJson(message) || undefined,
      };
    }
    const tool = message as ToolResultMessage;
    return {
      id,
      order,
      role: "tool",
      content: messageText(tool),
      toolName: tool.toolName,
    };
  });
}

function summaryUserMessage(record: CompactionRecord): Message {
  const canonical = summaryMessageForRecord(record, "native");
  const text = canonical.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

export async function maybeCompactSessionBeforeRun(
  store: SessionStore,
  sessionId: string,
): Promise<SessionEventEnvelope | undefined> {
  const events = store.loadSessionEvents(sessionId);
  const config = defaultCompactionConfig();
  const summarizer = compactionSummarizerEnv();
  if (!config.enabled || !summarizer.apiKey) {
    return undefined;
  }

  const raw = projectRawCanonicalMessages(events);
  const active = findLatestCompactionRecord(events);
  const anchors = buildTokenAnchorsFromEvents(events);
  const rows = canonicalToCompactionRows(raw, anchors);
  const result = await maybeCompact({
    config,
    rows,
    active,
    summarize: async (folded, priorSummary) =>
      summarizeWithFetch({
        messages: buildSummarizerMessages(folded, priorSummary, config),
        ...summarizer,
      }),
  });
  if (!result) return undefined;

  return store.appendSessionEvent({
    sessionId,
    runtimeKind: "native",
    runId: "session",
    messageId: result.summaryMessage.id,
    idempotencyKey: `compaction:${result.record.id}`,
    event: {
      kind: "compaction.applied",
      compactionId: result.record.id,
      throughMessageId: result.record.throughMessageId,
      summary: result.summaryMessage,
      replacedMessageIds: result.record.replacedMessageIds,
      replacedCount: result.record.replacedCount,
      estimatedTokens: result.record.estimatedTokens,
    },
  });
}

export async function maybeCompactRuntimeContextIfNeeded(
  context: Context,
  active: CompactionRecord | undefined,
): Promise<Context> {
  const config = defaultCompactionConfig();
  const summarizer = compactionSummarizerEnv();
  if (!config.enabled || !summarizer.apiKey) {
    return context;
  }

  const rows = runtimeMessagesToCompactionRows(context.messages);
  const result = await maybeCompact({
    config,
    rows,
    active,
    summarize: async (folded, priorSummary) =>
      summarizeWithFetch({
        messages: buildSummarizerMessages(folded, priorSummary, config),
        ...summarizer,
      }),
  });
  if (!result) return context;

  const keptIds = new Set(
    rows
      .filter((row) => !result.record.replacedMessageIds.includes(row.id))
      .map((row) => row.id),
  );
  const kept = context.messages.filter((_, index) => {
    const row = rows[index];
    return row ? keptIds.has(row.id) : true;
  });
  return {
    ...context,
    messages: [summaryUserMessage(result.record), ...kept],
  };
}

export async function recoverRuntimeContextOverflow(
  context: Context,
  active: CompactionRecord | undefined,
): Promise<Context | undefined> {
  const config = defaultCompactionConfig();
  const summarizer = compactionSummarizerEnv();
  if (!config.enabled || !summarizer.apiKey) {
    return undefined;
  }

  const rows = runtimeMessagesToCompactionRows(context.messages);
  const result = await maybeCompact({
    config,
    rows,
    active,
    summarize: async (folded, priorSummary) =>
      summarizeWithFetch({
        messages: buildSummarizerMessages(folded, priorSummary, config),
        ...summarizer,
      }),
  });
  if (!result) return undefined;

  const keptIds = new Set(
    rows
      .filter((row) => !result.record.replacedMessageIds.includes(row.id))
      .map((row) => row.id),
  );
  const kept = context.messages.filter((_, index) => {
    const row = rows[index];
    return row ? keptIds.has(row.id) : true;
  });

  return {
    ...context,
    messages: [summaryUserMessage(result.record), ...kept],
  };
}

export function projectSessionAgentMessages(
  events: readonly SessionEventEnvelope[],
) {
  return projectAgentMessages(events);
}

export function wrapSummaryEnvelope(compactionId: string, summary: string): string {
  return wrapSummary(compactionId, summary);
}
