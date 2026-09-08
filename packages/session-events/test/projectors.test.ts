import type {
  CanonicalMessage,
  SessionEvent,
  SessionEventEnvelope,
  StreamFrameEnvelope,
} from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import {
  projectCanonicalMessages,
  projectTimelineSnapshot,
  TimelineProjector,
} from "../src/index.js";

const user: CanonicalMessage = {
  id: "user-1",
  role: "user",
  content: [{ type: "text", text: "hello" }],
  sourceRuntime: "native",
  createdAt: 1,
};

function event(
  seq: number,
  value: SessionEvent,
  extra: Partial<SessionEventEnvelope> = {},
): SessionEventEnvelope {
  return {
    sessionId: "session",
    seq,
    schemaVersion: 1,
    runtimeKind: "native",
    emittedAt: seq,
    runId: "run",
    ...extra,
    event: value,
  };
}

describe("session event projectors", () => {
  it("deduplicates canonical messages by stable identity", () => {
    expect(
      projectCanonicalMessages([
        event(1, { kind: "run.started", userMessage: user }),
        event(2, { kind: "message.user.committed", message: user }),
      ]),
    ).toEqual([user]);
  });

  it("projects attachment metadata on run_start", () => {
    const userWithAttachment: CanonicalMessage = {
      id: "user-2",
      role: "user",
      content: [
        {
          type: "attachment",
          attachmentId: ".pi-ling/attachments/a.png",
          mediaType: "image/png",
          name: "a.png",
        },
        { type: "text", text: "look at this" },
      ],
      sourceRuntime: "native",
      createdAt: 3,
    };
    const snapshot = projectTimelineSnapshot("session", [
      event(1, { kind: "run.started", userMessage: userWithAttachment }),
    ]);
    const runStart = snapshot.events.find(
      (entry) => entry.event.type === "run_start",
    )?.event;
    expect(runStart?.type).toBe("run_start");
    if (runStart?.type !== "run_start") return;
    expect(runStart.prompt).toBe("look at this");
    expect(runStart.attachments).toEqual([
      {
        relativePath: ".pi-ling/attachments/a.png",
        name: "a.png",
        mediaType: "image/png",
      },
    ]);
  });

  it("projects committed messages into the legacy timeline", () => {
    const assistant: CanonicalMessage = {
      id: "assistant-1",
      role: "assistant",
      content: [
        { type: "reasoning", text: "think" },
        { type: "text", text: "done" },
      ],
      sourceRuntime: "native",
      createdAt: 2,
    };
    const snapshot = projectTimelineSnapshot("session", [
      event(1, { kind: "run.started", userMessage: user }),
      event(
        2,
        {
          kind: "message.assistant.committed",
          message: assistant,
          stopReason: "stop",
          usage: { input: 1, output: 1, totalTokens: 2, cost: 0 },
        },
        { messageId: assistant.id, turnId: "turn" },
      ),
      event(3, { kind: "run.ended", status: "completed" }),
    ]);
    expect(snapshot.events.map(({ event }) => event.type)).toEqual([
      "run_start",
      "assistant_start",
      "assistant_thinking_delta",
      "assistant_text_delta",
      "assistant_end",
      "run_end",
    ]);
    expect(snapshot.events.map(({ seq }) => seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("replays only uncommitted buffered frames", () => {
    const frames: StreamFrameEnvelope[] = [
      {
        sessionId: "session",
        runId: "run",
        frameSeq: 1,
        emittedAt: 1,
        turnId: "turn",
        messageId: "draft",
        frame: { kind: "assistant.text.delta", delta: "draft" },
      },
    ];
    const snapshot = projectTimelineSnapshot("session", [], frames);
    expect(snapshot.events.map(({ event }) => event.type)).toEqual([
      "assistant_start",
      "assistant_text_delta",
    ]);
  });

  it("does not mark a requested tool running before execution starts", () => {
    const snapshot = projectTimelineSnapshot("session", [
      event(
        1,
        {
          kind: "tool.call.committed",
          toolCall: {
            id: "call",
            name: "read_file",
            input: { path: "agent.md" },
          },
        },
        { turnId: "turn", toolCallId: "call" },
      ),
      event(
        2,
        {
          kind: "tool.execution.started",
          toolCallId: "call",
        },
        { turnId: "turn", toolCallId: "call" },
      ),
    ]);
    expect(snapshot.events.map(({ event }) => event.type)).toEqual([
      "tool_requested",
      "tool_start",
    ]);
  });

  it("incrementally projects the same snapshot as the batch fold", () => {
    const assistant: CanonicalMessage = {
      id: "assistant-1",
      role: "assistant",
      content: [
        { type: "reasoning", text: "think" },
        { type: "text", text: "done" },
      ],
      sourceRuntime: "native",
      createdAt: 2,
    };
    const envelopes = [
      event(1, { kind: "run.started", userMessage: user }),
      event(
        2,
        {
          kind: "message.assistant.committed",
          message: assistant,
          stopReason: "stop",
          usage: { input: 1, output: 1, totalTokens: 2, cost: 0 },
        },
        { messageId: assistant.id, turnId: "turn" },
      ),
      event(3, { kind: "run.ended", status: "completed" }),
    ];
    const batch = projectTimelineSnapshot("session", envelopes);
    const projector = new TimelineProjector("session");
    const incremental = envelopes.flatMap((envelope) =>
      projector.push(envelope),
    );
    expect(incremental.map(({ event }) => event.type)).toEqual(
      batch.events.map(({ event }) => event.type),
    );
    expect(projector.snapshot()).toEqual(batch);
  });

  it("skips duplicate session event seq on idempotent replay", () => {
    const projector = new TimelineProjector("session");
    const started = event(1, { kind: "run.started", userMessage: user });
    expect(projector.push(started)).toHaveLength(1);
    expect(projector.push(started)).toEqual([]);
    expect(projector.snapshot().events).toHaveLength(1);
  });
});
