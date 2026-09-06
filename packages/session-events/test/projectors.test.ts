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
});
