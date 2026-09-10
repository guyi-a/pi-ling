import type {
  CanonicalContentBlock,
  CanonicalMessage,
  SessionEventEnvelope,
  StreamFrameEnvelope,
  TimelineSnapshot,
} from "@pi-ling/contracts";
import {
  buildTokenAnchorsFromEvents,
  canonicalToCompactionRows,
  findLatestCompactionRecord,
  projectAgentMessages as applyAgentCompaction,
} from "@pi-ling/compaction";

import { TimelineProjector } from "./timeline-projector.js";

export { TimelineProjector } from "./timeline-projector.js";

function taskNotificationContent(event: {
  taskId: string;
  status: string;
  description: string;
  summary?: string;
  error?: string;
}): string {
  const details =
    event.status === "completed"
      ? event.summary ?? "Task completed without a summary."
      : event.error ?? `Task ended with status ${event.status}.`;
  return `<task-notification task-id="${event.taskId}" status="${event.status}">
${event.description}

${details}

This asynchronous task has finished. Continue the original user request now
using this result. Do not wait for another user message merely to acknowledge
the notification.
</task-notification>`;
}

function assistantToolCallIds(message: CanonicalMessage): string[] {
  return message.content
    .filter(
      (block): block is Extract<CanonicalContentBlock, { type: "tool-call" }> =>
        block.type === "tool-call",
    )
    .map((block) => block.toolCallId);
}

/** Full canonical history without compaction folding — for UI and token estimation. */
export function projectRawCanonicalMessages(
  events: readonly SessionEventEnvelope[],
): CanonicalMessage[] {
  const messages: CanonicalMessage[] = [];
  const seen = new Set<string>();
  const append = (message: CanonicalMessage) => {
    if (seen.has(message.id)) return;
    seen.add(message.id);
    messages.push(message);
  };

  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const declaringByCallId = new Map<string, CanonicalMessage>();
  for (const envelope of sorted) {
    if (envelope.event.kind !== "message.assistant.committed") continue;
    for (const callId of assistantToolCallIds(envelope.event.message)) {
      declaringByCallId.set(callId, envelope.event.message);
    }
  }

  const declaredCallIds = new Set<string>();
  const declare = (message: CanonicalMessage) => {
    for (const callId of assistantToolCallIds(message)) {
      declaredCallIds.add(callId);
    }
  };

  for (const envelope of sorted) {
    const event = envelope.event;
    if (event.kind === "run.started") {
      append(event.userMessage);
    } else if (event.kind === "message.user.committed") {
      append(event.message);
    } else if (event.kind === "message.assistant.committed") {
      append(event.message);
      declare(event.message);
    } else if (event.kind === "tool.result.committed") {
      if (!declaredCallIds.has(event.result.toolCallId)) {
        const declaring = declaringByCallId.get(event.result.toolCallId);
        if (declaring && !seen.has(declaring.id)) {
          append(declaring);
          declare(declaring);
        }
      }
      append({
        id: envelope.messageId ?? `tool:${event.result.toolCallId}`,
        role: "tool",
        sourceRuntime: envelope.runtimeKind,
        createdAt: envelope.emittedAt,
        content: [
          {
            type: "tool-result",
            toolCallId: event.result.toolCallId,
            content: event.result.content,
            isError: event.result.isError,
          },
        ],
        ...(event.result.rawPayload
          ? { rawPayload: event.result.rawPayload }
          : {}),
      });
    } else if (event.kind === "compaction.applied") {
      // UI / raw projection keeps full history; compaction is agent-only.
    } else if (event.kind === "task.notified") {
      append({
        id: envelope.messageId ?? `task-notification:${event.taskId}`,
        role: "user",
        sourceRuntime: envelope.runtimeKind,
        createdAt: envelope.emittedAt,
        content: [{ type: "text", text: taskNotificationContent(event) }],
        rawPayload: { internal: true, taskNotification: event.taskId },
      });
    }
  }
  return messages;
}

/** Agent-facing projection: applies the latest compaction anchor. */
export function projectAgentMessages(
  events: readonly SessionEventEnvelope[],
): CanonicalMessage[] {
  const raw = projectRawCanonicalMessages(events);
  const active = findLatestCompactionRecord(events);
  if (!active) return raw;
  const anchors = buildTokenAnchorsFromEvents(events);
  const rows = canonicalToCompactionRows(raw, anchors);
  return applyAgentCompaction(raw, active, rows);
}

/** Alias for agent rehydrate / DSH seed paths. */
export const projectCanonicalMessages = projectAgentMessages;

export function projectTimelineSnapshot(
  sessionId: string,
  events: readonly SessionEventEnvelope[],
  frames: readonly StreamFrameEnvelope[] = [],
): TimelineSnapshot {
  const projector = new TimelineProjector(sessionId, events);
  projector.pushFrames(frames);
  return projector.snapshot();
}
