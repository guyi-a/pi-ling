import type {
  CanonicalContentBlock,
  CanonicalMessage,
  SessionEventEnvelope,
  StreamFrameEnvelope,
  TimelineSnapshot,
} from "@pi-ling/contracts";

import { TimelineProjector } from "./timeline-projector.js";

export { TimelineProjector } from "./timeline-projector.js";

function assistantToolCallIds(message: CanonicalMessage): string[] {
  return message.content
    .filter(
      (block): block is Extract<CanonicalContentBlock, { type: "tool-call" }> =>
        block.type === "tool-call",
    )
    .map((block) => block.toolCallId);
}

export function projectCanonicalMessages(
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
  // A DSH turn commits its assistant message (which declares its tool calls)
  // only when the turn ends, so a tool.result.committed can land before the
  // assistant message that declares it. DeepSeek/Anthropic both require the
  // declaration to precede its result, so pre-index declaring messages here
  // and splice them in ahead of any early tool result.
  const declaringByCallId = new Map<string, CanonicalMessage>();
  for (const envelope of sorted) {
    if (envelope.event.kind !== "message.assistant.committed") continue;
    for (const callId of assistantToolCallIds(envelope.event.message)) {
      declaringByCallId.set(
        callId,
        envelope.event.message,
      );
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
      const replaced = new Set(event.replacedMessageIds);
      const kept = messages.filter((message) => !replaced.has(message.id));
      messages.splice(0, messages.length, ...kept);
      for (const id of replaced) seen.delete(id);
      append(event.summary);
    }
  }
  return messages;
}

export function projectTimelineSnapshot(
  sessionId: string,
  events: readonly SessionEventEnvelope[],
  frames: readonly StreamFrameEnvelope[] = [],
): TimelineSnapshot {
  const projector = new TimelineProjector(sessionId, events);
  projector.pushFrames(frames);
  return projector.snapshot();
}
