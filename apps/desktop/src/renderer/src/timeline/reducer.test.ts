import type {
  TimelineEnvelope,
  TimelineEvent,
  TimelineSnapshot,
} from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import {
  applyTimelineEnvelope,
  applyTimelineSnapshot,
  applyStreamFrame,
  createTimelineState,
} from "./reducer";

function envelope(
  seq: number,
  event: TimelineEvent,
  options: { sessionId?: string; runId?: string } = {},
): TimelineEnvelope {
  return {
    sessionId: options.sessionId ?? "session-1",
    runId: options.runId ?? "run-1",
    seq,
    emittedAt: seq,
    event,
  };
}

const sequence: TimelineEnvelope[] = [
  envelope(1, {
    type: "run_start",
    userItemId: "run-1:user",
    prompt: "edit file",
  }),
  envelope(2, {
    type: "turn_start",
    turnId: "run-1:turn:1",
    turn: 1,
  }),
  envelope(3, {
    type: "assistant_start",
    turnId: "run-1:turn:1",
    itemId: "run-1:turn:1:assistant",
  }),
  envelope(4, {
    type: "assistant_end",
    turnId: "run-1:turn:1",
    itemId: "run-1:turn:1:assistant",
    stopReason: "toolUse",
    usage: { input: 1, output: 1, totalTokens: 2, cost: 0 },
  }),
  envelope(5, {
    type: "tool_requested",
    turnId: "run-1:turn:1",
    itemId: "call-1",
    callId: "call-1",
    tool: "write_file",
    arguments: { path: "a.txt", content: "a" },
  }),
  envelope(6, {
    type: "approval_requested",
    turnId: "run-1:turn:1",
    itemId: "call-1:approval",
    toolItemId: "call-1",
    approval: {
      callId: "call-1",
      tool: "write_file",
      arguments: { path: "a.txt", content: "a" },
      effect: { kind: "filesystem-write" },
      effectDigest: "digest",
      reason: "write",
    },
  }),
  envelope(7, {
    type: "approval_resolved",
    turnId: "run-1:turn:1",
    itemId: "call-1:approval",
    toolItemId: "call-1",
    callId: "call-1",
    approved: true,
  }),
  envelope(8, {
    type: "tool_start",
    turnId: "run-1:turn:1",
    itemId: "call-1",
    callId: "call-1",
    tool: "write_file",
    arguments: { path: "a.txt", content: "a" },
  }),
  envelope(9, {
    type: "tool_end",
    turnId: "run-1:turn:1",
    itemId: "call-1",
    callId: "call-1",
    tool: "write_file",
    isError: false,
    output: "written",
  }),
  envelope(10, {
    type: "turn_start",
    turnId: "run-1:turn:2",
    turn: 2,
  }),
  envelope(11, {
    type: "assistant_start",
    turnId: "run-1:turn:2",
    itemId: "run-1:turn:2:assistant",
  }),
];

describe("timeline reducer", () => {
  it("keeps assistant turns, tools and approvals in first-seen order", () => {
    const state = sequence.reduce(applyTimelineEnvelope, createTimelineState());
    expect(state.items.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "tool",
      "approval",
      "assistant",
    ]);
    expect(
      state.items.filter((item) => item.kind === "assistant").map((item) => item.id),
    ).toEqual([
      "run-1:turn:1:assistant",
      "run-1:turn:2:assistant",
    ]);
  });

  it("is idempotent when events replay", () => {
    const once = sequence.reduce(
      applyTimelineEnvelope,
      createTimelineState(),
    );
    const twice = sequence.reduce(applyTimelineEnvelope, once);
    expect(twice.items).toEqual(once.items);
    expect(twice.lastSeq).toBe(once.lastSeq);
  });

  it("settles tools that never finished when a run fails", () => {
    const events = [
      envelope(1, {
        type: "run_start",
        userItemId: "user",
        prompt: "inspect",
      }),
      ...["first", "second"].map((callId, index) =>
        envelope(index + 2, {
          type: "tool_requested" as const,
          turnId: "turn",
          itemId: callId,
          callId,
          tool: "list_files",
          arguments: { path: "." },
        }),
      ),
      envelope(4, { type: "run_end", status: "error" }),
    ];
    const state = events.reduce(
      applyTimelineEnvelope,
      createTimelineState(),
    );
    expect(
      state.items
        .filter((item) => item.kind === "tool")
        .map((item) => item.status),
    ).toEqual(["failed", "cancelled"]);
  });

  it("buffers gaps and drains them when missing events arrive", () => {
    let state = createTimelineState();
    state = applyTimelineEnvelope(state, sequence[2]!);
    state = applyTimelineEnvelope(state, sequence[1]!);
    expect(state.items).toHaveLength(0);
    state = applyTimelineEnvelope(state, sequence[0]!);
    expect(state.lastSeq).toBe(3);
    expect(state.items.map((item) => item.kind)).toEqual(["user", "assistant"]);
  });

  it("switches cleanly when a new session starts", () => {
    let state = applyTimelineEnvelope(createTimelineState(), sequence[0]!);
    state = applyTimelineEnvelope(
      state,
      envelope(
        1,
        {
          type: "run_start",
          userItemId: "run-2:user",
          prompt: "new session",
        },
        { sessionId: "session-2", runId: "run-2" },
      ),
    );
    expect(state.sessionId).toBe("session-2");
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.runId).toBe("run-2");
  });

  it("merges a snapshot with live events received first", () => {
    const liveFirst = applyTimelineEnvelope(
      createTimelineState(),
      sequence[2]!,
    );
    const snapshot: TimelineSnapshot = {
      sessionId: "session-1",
      lastSeq: 2,
      events: sequence.slice(0, 2),
    };
    const merged = applyTimelineSnapshot(liveFirst, snapshot);
    expect(merged.lastSeq).toBe(3);
    expect(merged.items.map((item) => item.kind)).toEqual(["user", "assistant"]);
  });

  it("ignores assistant frames until commit and rejects duplicates", () => {
    const base = {
      ...createTimelineState(),
      sessionId: "session-1",
    };
    const frame = {
      sessionId: "session-1",
      runId: "run-1",
      frameSeq: 1,
      emittedAt: 1,
      turnId: "turn",
      messageId: "draft",
      frame: { kind: "assistant.text.delta" as const, delta: "hello" },
    };
    const once = applyStreamFrame(base, frame);
    const twice = applyStreamFrame(once, frame);
    expect(twice.items).toHaveLength(0);
    expect(twice.frameSeqByRun["run-1"]).toBe(1);
    expect(
      applyStreamFrame(once, { ...frame, sessionId: "session-2" }),
    ).toBe(once);
  });
});
