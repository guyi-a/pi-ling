import type {
  CanonicalContentBlock,
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

export class TimelineProjector {
  readonly #sessionId: string;
  readonly #projected: TimelineEnvelope[] = [];
  readonly #assistantIds = new Set<string>();
  readonly #committedAssistantIds = new Set<string>();
  readonly #toolNames = new Map<string, string>();
  readonly #toolInputs = new Map<string, Record<string, unknown>>();
  #lastFoldedSessionSeq = 0;

  constructor(
    sessionId: string,
    events: readonly SessionEventEnvelope[] = [],
  ) {
    this.#sessionId = sessionId;
    for (const envelope of [...events].sort((left, right) => left.seq - right.seq)) {
      this.push(envelope);
    }
  }

  push(envelope: SessionEventEnvelope): TimelineEnvelope[] {
    if (envelope.seq <= this.#lastFoldedSessionSeq) {
      return [];
    }
    this.#lastFoldedSessionSeq = envelope.seq;
    return this.#foldSessionEvent(envelope);
  }

  pushFrames(frames: readonly StreamFrameEnvelope[]): TimelineEnvelope[] {
    const emitted: TimelineEnvelope[] = [];
    for (const frame of [...frames].sort(
      (left, right) => left.frameSeq - right.frameSeq,
    )) {
      if (frame.messageId && this.#committedAssistantIds.has(frame.messageId)) {
        continue;
      }
      const turnId = frame.turnId ?? `${frame.runId}:turn:1`;
      if (
        (frame.frame.kind === "assistant.text.delta" ||
          frame.frame.kind === "assistant.reasoning.delta") &&
        frame.messageId
      ) {
        if (!this.#assistantIds.has(frame.messageId)) {
          this.#assistantIds.add(frame.messageId);
          emitted.push(
            this.#emit(frame, {
              type: "assistant_start",
              turnId,
              itemId: frame.messageId,
            }),
          );
        }
        emitted.push(
          this.#emit(
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
          ),
        );
      }
    }
    return emitted;
  }

  snapshot(): TimelineSnapshot {
    return {
      sessionId: this.#sessionId,
      lastSeq: this.#projected.length,
      events: [...this.#projected],
    };
  }

  #emit(
    source: {
      runId?: string;
      emittedAt: number;
    },
    event: TimelineEvent,
  ): TimelineEnvelope {
    const envelope: TimelineEnvelope = {
      sessionId: this.#sessionId,
      runId: source.runId ?? "session",
      seq: this.#projected.length + 1,
      emittedAt: source.emittedAt,
      event,
    };
    this.#projected.push(envelope);
    return envelope;
  }

  #foldSessionEvent(envelope: SessionEventEnvelope): TimelineEnvelope[] {
    const emitted: TimelineEnvelope[] = [];
    const event = envelope.event;
    const runId = envelope.runId ?? "session";
    const turnId = envelope.turnId ?? `${runId}:turn:1`;
    const push = (timelineEvent: TimelineEvent) => {
      emitted.push(this.#emit(envelope, timelineEvent));
    };

    if (event.kind === "run.started") {
      const attachments = event.userMessage.content
        .filter(
          (
            block,
          ): block is Extract<CanonicalContentBlock, { type: "attachment" }> =>
            block.type === "attachment",
        )
        .map((block) => ({
          relativePath: block.attachmentId,
          name: block.name ?? block.attachmentId.split("/").pop() ?? block.attachmentId,
          mediaType: block.mediaType,
        }));
      push({
        type: "run_start",
        userItemId: event.userMessage.id,
        prompt: event.continuation
          ? ""
          : messageText(event.userMessage.content, "text"),
        ...(event.continuation ? { continuation: true } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    } else if (event.kind === "run.ended") {
      push({ type: "run_end", status: event.status });
    } else if (event.kind === "turn.started") {
      push({ type: "turn_start", turnId, turn: event.turn });
    } else if (event.kind === "turn.ended") {
      push({ type: "turn_end", turnId });
    } else if (event.kind === "message.assistant.committed") {
      const messageId = event.message.id;
      this.#assistantIds.add(messageId);
      this.#committedAssistantIds.add(messageId);
      push({
        type: "assistant_start",
        turnId,
        itemId: messageId,
      });
      const reasoning = messageText(event.message.content, "reasoning");
      if (reasoning) {
        push({
          type: "assistant_thinking_delta",
          turnId,
          itemId: messageId,
          delta: reasoning,
        });
      }
      const text = messageText(event.message.content, "text");
      if (text) {
        push({
          type: "assistant_text_delta",
          turnId,
          itemId: messageId,
          delta: text,
        });
      }
      push({
        type: "assistant_end",
        turnId,
        itemId: messageId,
        stopReason: event.stopReason,
        usage: event.usage,
        ...(event.contextUsage ? { contextUsage: event.contextUsage } : {}),
        ...(event.error ? { error: event.error } : {}),
      });
    } else if (event.kind === "tool.call.committed") {
      this.#toolNames.set(event.toolCall.id, event.toolCall.name);
      this.#toolInputs.set(event.toolCall.id, event.toolCall.input);
      push({
        type: "tool_requested",
        turnId,
        itemId: event.toolCall.id,
        callId: event.toolCall.id,
        tool: event.toolCall.name,
        arguments: event.toolCall.input,
      });
    } else if (event.kind === "tool.execution.started") {
      push({
        type: "tool_start",
        turnId,
        itemId: event.toolCallId,
        callId: event.toolCallId,
        tool: this.#toolNames.get(event.toolCallId) ?? "tool",
        arguments: this.#toolInputs.get(event.toolCallId) ?? {},
      });
    } else if (event.kind === "tool.result.committed") {
      push({
        type: "tool_end",
        turnId,
        itemId: event.result.toolCallId,
        callId: event.result.toolCallId,
        tool: this.#toolNames.get(event.result.toolCallId) ?? "tool",
        isError: event.result.isError,
        output: event.result.content,
      });
    } else if (event.kind === "approval.requested") {
      push({
        type: "approval_requested",
        turnId,
        itemId: `${event.approval.callId}:approval`,
        toolItemId: event.toolItemId,
        approval: event.approval,
      });
    } else if (event.kind === "approval.resolved") {
      push({
        type: "approval_resolved",
        turnId,
        itemId: `${event.callId}:approval`,
        toolItemId: event.toolItemId,
        callId: event.callId,
        approved: event.approved,
      });
    } else if (event.kind === "question.requested") {
      push({
        type: "question_requested",
        turnId,
        itemId: `${event.question.callId}:question`,
        toolItemId: event.toolItemId,
        question: event.question,
      });
    } else if (event.kind === "question.answered") {
      push({
        type: "question_answered",
        turnId,
        itemId: `${event.callId}:question`,
        toolItemId: event.toolItemId,
        callId: event.callId,
        answers: event.answers,
      });
    } else if (event.kind === "changes.committed") {
      push({
        type: "changes",
        turnId,
        itemId: `${event.callId}:changes`,
        callId: event.callId,
        files: event.files,
      });
    } else if (event.kind === "compaction.applied") {
      push({
        type: "compaction_marker",
        itemId: `compaction:${event.compactionId}`,
        compactionId: event.compactionId,
        replacedCount: event.replacedCount,
        throughMessageId: event.throughMessageId,
      });
    }

    return emitted;
  }
}
