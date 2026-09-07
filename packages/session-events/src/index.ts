import type {
  CanonicalContentBlock,
  CanonicalMessage,
  SessionEventEnvelope,
  StreamFrameEnvelope,
  TimelineEnvelope,
  TimelineEvent,
  TimelineSnapshot,
} from "@pi-ling/contracts";

function messageText(
  blocks: readonly CanonicalContentBlock[],
  type: "text" | "reasoning",
): string {
  return blocks
    .filter(
      (
        block,
      ): block is Extract<CanonicalContentBlock, { type: typeof type }> =>
        block.type === type,
    )
    .map((block) => block.text)
    .join("");
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

  for (const envelope of [...events].sort((a, b) => a.seq - b.seq)) {
    const event = envelope.event;
    if (event.kind === "run.started") {
      append(event.userMessage);
    } else if (event.kind === "message.user.committed") {
      append(event.message);
    } else if (event.kind === "message.assistant.committed") {
      append(event.message);
    } else if (event.kind === "tool.result.committed") {
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
  const projected: TimelineEnvelope[] = [];
  const assistantIds = new Set<string>();
  const committedAssistantIds = new Set<string>();
  const toolNames = new Map<string, string>();
  const toolInputs = new Map<string, Record<string, unknown>>();

  const emit = (
    source: {
      runId?: string;
      emittedAt: number;
    },
    event: TimelineEvent,
  ) => {
    projected.push({
      sessionId,
      runId: source.runId ?? "session",
      seq: projected.length + 1,
      emittedAt: source.emittedAt,
      event,
    });
  };

  for (const envelope of [...events].sort((a, b) => a.seq - b.seq)) {
    const event = envelope.event;
    const runId = envelope.runId ?? "session";
    const turnId = envelope.turnId ?? `${runId}:turn:1`;
    if (event.kind === "run.started") {
      emit(envelope, {
        type: "run_start",
        userItemId: event.userMessage.id,
        prompt: messageText(event.userMessage.content, "text"),
      });
    } else if (event.kind === "run.ended") {
      emit(envelope, { type: "run_end", status: event.status });
    } else if (event.kind === "turn.started") {
      emit(envelope, { type: "turn_start", turnId, turn: event.turn });
    } else if (event.kind === "turn.ended") {
      emit(envelope, { type: "turn_end", turnId });
    } else if (event.kind === "message.assistant.committed") {
      const messageId = event.message.id;
      assistantIds.add(messageId);
      committedAssistantIds.add(messageId);
      emit(envelope, {
        type: "assistant_start",
        turnId,
        itemId: messageId,
      });
      const reasoning = messageText(event.message.content, "reasoning");
      if (reasoning) {
        emit(envelope, {
          type: "assistant_thinking_delta",
          turnId,
          itemId: messageId,
          delta: reasoning,
        });
      }
      const text = messageText(event.message.content, "text");
      if (text) {
        emit(envelope, {
          type: "assistant_text_delta",
          turnId,
          itemId: messageId,
          delta: text,
        });
      }
      emit(envelope, {
        type: "assistant_end",
        turnId,
        itemId: messageId,
        stopReason: event.stopReason,
        usage: event.usage,
        ...(event.contextUsage ? { contextUsage: event.contextUsage } : {}),
        ...(event.error ? { error: event.error } : {}),
      });
    } else if (event.kind === "tool.call.committed") {
      toolNames.set(event.toolCall.id, event.toolCall.name);
      toolInputs.set(event.toolCall.id, event.toolCall.input);
      emit(envelope, {
        type: "tool_requested",
        turnId,
        itemId: event.toolCall.id,
        callId: event.toolCall.id,
        tool: event.toolCall.name,
        arguments: event.toolCall.input,
      });
    } else if (event.kind === "tool.execution.started") {
      emit(envelope, {
        type: "tool_start",
        turnId,
        itemId: event.toolCallId,
        callId: event.toolCallId,
        tool: toolNames.get(event.toolCallId) ?? "tool",
        arguments: toolInputs.get(event.toolCallId) ?? {},
      });
    } else if (event.kind === "tool.result.committed") {
      emit(envelope, {
        type: "tool_end",
        turnId,
        itemId: event.result.toolCallId,
        callId: event.result.toolCallId,
        tool: toolNames.get(event.result.toolCallId) ?? "tool",
        isError: event.result.isError,
        output: event.result.content,
      });
    } else if (event.kind === "approval.requested") {
      emit(envelope, {
        type: "approval_requested",
        turnId,
        itemId: `${event.approval.callId}:approval`,
        toolItemId: event.toolItemId,
        approval: event.approval,
      });
    } else if (event.kind === "approval.resolved") {
      emit(envelope, {
        type: "approval_resolved",
        turnId,
        itemId: `${event.callId}:approval`,
        toolItemId: event.toolItemId,
        callId: event.callId,
        approved: event.approved,
      });
    } else if (event.kind === "changes.committed") {
      emit(envelope, {
        type: "changes",
        turnId,
        itemId: `${event.callId}:changes`,
        callId: event.callId,
        files: event.files,
      });
    }
  }

  for (const frame of [...frames].sort((a, b) => a.frameSeq - b.frameSeq)) {
    if (frame.messageId && committedAssistantIds.has(frame.messageId)) continue;
    const turnId = frame.turnId ?? `${frame.runId}:turn:1`;
    if (
      (frame.frame.kind === "assistant.text.delta" ||
        frame.frame.kind === "assistant.reasoning.delta") &&
      frame.messageId
    ) {
      if (!assistantIds.has(frame.messageId)) {
        assistantIds.add(frame.messageId);
        emit(frame, {
          type: "assistant_start",
          turnId,
          itemId: frame.messageId,
        });
      }
      emit(
        frame,
        frame.frame.kind === "assistant.text.delta"
          ? {
              type: "assistant_text_delta",
              turnId,
              itemId: frame.messageId,
              delta: frame.frame.delta,
            }
          : {
              type: "assistant_thinking_delta",
              turnId,
              itemId: frame.messageId,
              delta: frame.frame.delta,
            },
      );
    }
  }

  return {
    sessionId,
    lastSeq: projected.length,
    events: projected,
  };
}
