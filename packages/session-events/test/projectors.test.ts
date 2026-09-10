import type {
  CanonicalMessage,
  SessionEvent,
  SessionEventEnvelope,
  StreamFrameEnvelope,
} from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import {
  projectAgentMessages,
  projectCanonicalMessages,
  projectRawCanonicalMessages,
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
  it("projects task.notified into a synthetic user message", () => {
    const messages = projectCanonicalMessages([
      event(1, { kind: "run.started", userMessage: user }),
      event(2, {
        kind: "task.notified",
        taskId: "task-1",
        status: "completed",
        description: "Explore auth",
        summary: "Auth is in src/auth.ts",
      }),
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content[0]).toMatchObject({
      type: "text",
    });
    const text =
      messages[1]?.content[0]?.type === "text"
        ? messages[1].content[0].text
        : "";
    expect(text).toContain("<task-notification");
    expect(text).toContain("Auth is in src/auth.ts");
  });

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

  it("keeps raw canonical history while agent projection folds compaction", () => {
    const assistant: CanonicalMessage = {
      id: "assistant-old",
      role: "assistant",
      content: [{ type: "text", text: "old answer" }],
      sourceRuntime: "native",
      createdAt: 2,
    };
    const summary: CanonicalMessage = {
      id: "compaction:comp-1",
      role: "user",
      content: [{ type: "text", text: "<compacted-summary>secret</compacted-summary>" }],
      sourceRuntime: "native",
      createdAt: 3,
      rawPayload: { internal: true, compaction: true },
    };
    const events = [
      event(1, { kind: "run.started", userMessage: user }),
      event(2, {
        kind: "message.assistant.committed",
        message: assistant,
        stopReason: "stop",
      }),
      event(3, {
        kind: "compaction.applied",
        compactionId: "comp-1",
        throughMessageId: assistant.id,
        summary,
        replacedMessageIds: [user.id, assistant.id],
        replacedCount: 2,
      }),
      event(4, {
        kind: "run.started",
        userMessage: {
          ...user,
          id: "user-2",
          content: [{ type: "text", text: "continue" }],
        },
      }),
    ];
    expect(projectRawCanonicalMessages(events)).toHaveLength(3);
    expect(projectAgentMessages(events).map((message) => message.id)).toEqual([
      "compaction:comp-1",
      "user-2",
    ]);
    expect(projectCanonicalMessages(events)).toEqual(projectAgentMessages(events));
  });

  it("projects compaction.applied into a timeline marker without summary text", () => {
    const summary: CanonicalMessage = {
      id: "compaction:comp-1",
      role: "user",
      content: [{ type: "text", text: "<compacted-summary>secret</compacted-summary>" }],
      sourceRuntime: "native",
      createdAt: 3,
      rawPayload: { internal: true, compaction: true },
    };
    const snapshot = projectTimelineSnapshot("session", [
      event(1, { kind: "run.started", userMessage: user }),
      event(2, {
        kind: "compaction.applied",
        compactionId: "comp-1",
        throughMessageId: user.id,
        summary,
        replacedMessageIds: [user.id],
        replacedCount: 1,
      }),
    ]);
    const marker = snapshot.events.find(
      (entry) => entry.event.type === "compaction_marker",
    )?.event;
    expect(marker?.type).toBe("compaction_marker");
    if (marker?.type !== "compaction_marker") return;
    expect(marker.replacedCount).toBe(1);
    expect(JSON.stringify(snapshot.events)).not.toContain("secret");
  });

  it("skips duplicate session event seq on idempotent replay", () => {
    const projector = new TimelineProjector("session");
    const started = event(1, { kind: "run.started", userMessage: user });
    expect(projector.push(started)).toHaveLength(1);
    expect(projector.push(started)).toEqual([]);
    expect(projector.snapshot().events).toHaveLength(1);
  });
});
