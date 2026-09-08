import { describe, expect, it } from "vitest";

import type { TimelineEnvelope } from "@pi-ling/contracts";

import {
  groupTraceDisplayItems,
  resolveActiveTraceRunId,
  selectTraceEvents,
  summarizeTimelineEvent,
} from "./trace-event-summary";

function envelope(
  seq: number,
  runId: string,
  event: TimelineEnvelope["event"],
): TimelineEnvelope {
  return {
    sessionId: "session",
    runId,
    seq,
    emittedAt: 1_700_000_000_000 + seq,
    event,
  };
}

describe("trace-event-summary", () => {
  it("summarizes tool and run events", () => {
    expect(
      summarizeTimelineEvent(
        envelope(1, "run-a", {
          type: "run_start",
          userItemId: "u1",
          prompt: "hello world",
        }),
      ).label,
    ).toContain('run_start · "hello world"');

    expect(
      summarizeTimelineEvent(
        envelope(2, "run-a", {
          type: "tool_end",
          turnId: "t1",
          itemId: "tool1",
          callId: "c1",
          tool: "bash",
          isError: false,
          output: "ok",
        }),
      ).label,
    ).toBe("tool_end · bash · ok");
  });

  it("shows context usage when token totals are unavailable", () => {
    expect(
      summarizeTimelineEvent(
        envelope(3, "run-a", {
          type: "assistant_end",
          turnId: "t1",
          itemId: "a1",
          stopReason: "stop",
          usage: { input: 0, output: 0, totalTokens: 0, cost: 0 },
          contextUsage: { used: 8700, size: 1_000_000 },
        }),
      ).label,
    ).toBe("assistant_end · stop · 8.7k/1M context");
  });

  it("groups consecutive muted events for collapsed trace rows", () => {
    const events = [
      envelope(1, "run-a", {
        type: "run_start",
        userItemId: "u1",
        prompt: "hello",
      }),
      envelope(2, "run-a", {
        type: "assistant_start",
        turnId: "t1",
        itemId: "a1",
      }),
      envelope(3, "run-a", {
        type: "assistant_thinking_delta",
        turnId: "t1",
        itemId: "a1",
        delta: "thinking",
      }),
      envelope(4, "run-a", {
        type: "tool_end",
        turnId: "t1",
        itemId: "tool1",
        callId: "c1",
        tool: "read",
        isError: false,
        output: "ok",
      }),
    ];

    expect(groupTraceDisplayItems(events)).toEqual([
      { kind: "event", envelope: events[0] },
      {
        kind: "muted-group",
        envelopes: [events[1], events[2]],
        label: "assistant_start, assistant_thinking_delta",
      },
      { kind: "event", envelope: events[3] },
    ]);
  });

  it("selects active run events by running status first", () => {
    const events = [
      envelope(1, "run-old", {
        type: "run_start",
        userItemId: "u1",
        prompt: "old",
      }),
      envelope(2, "run-new", {
        type: "run_start",
        userItemId: "u2",
        prompt: "new",
      }),
      envelope(3, "run-new", {
        type: "tool_start",
        turnId: "t1",
        itemId: "tool1",
        callId: "c1",
        tool: "read",
        arguments: {},
      }),
    ];

    const filtered = selectTraceEvents(
      events,
      {
        "run-old": { id: "run-old", status: "completed" },
        "run-new": { id: "run-new", status: "running" },
      },
      "active",
      null,
    );

    expect(filtered).toHaveLength(2);
    expect(filtered.every((item) => item.runId === "run-new")).toBe(true);
  });

  it("falls back to the latest run_start when nothing is running", () => {
    const events = [
      envelope(1, "run-old", {
        type: "run_start",
        userItemId: "u1",
        prompt: "old",
      }),
      envelope(2, "run-latest", {
        type: "run_start",
        userItemId: "u2",
        prompt: "latest",
      }),
    ];

    expect(
      resolveActiveTraceRunId({
        events,
        runs: {
          "run-old": { id: "run-old", status: "completed" },
          "run-latest": { id: "run-latest", status: "completed" },
        },
        activeRunId: null,
      }),
    ).toBe("run-latest");
  });
});
