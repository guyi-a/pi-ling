import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TraceEmptyState } from "./TraceEmptyState";
import { TracePanel } from "./TracePanel";

describe("TracePanel", () => {
  it("renders the empty-state copy without a session", () => {
    const html = renderToStaticMarkup(
      <TracePanel
        sessionId={null}
        events={[]}
        runs={{}}
        activeRunId={null}
        active
      />,
    );
    expect(html).toContain("Trace");
    expect(html).toContain("开始对话后，运行事件将在此显示。");
  });

  it("renders the run filter and event count with data", () => {
    const html = renderToStaticMarkup(
      <TracePanel
        sessionId="session-1"
        activeRunId="run-1"
        runs={{ "run-1": { id: "run-1", status: "running" } }}
        events={[
          {
            sessionId: "session-1",
            runId: "run-1",
            seq: 1,
            emittedAt: 1_700_000_000_000,
            event: {
              type: "run_start",
              userItemId: "user-1",
              prompt: "hello",
            },
          },
          {
            sessionId: "session-1",
            runId: "run-1",
            seq: 2,
            emittedAt: 1_700_000_000_100,
            event: {
              type: "tool_end",
              turnId: "turn-1",
              itemId: "tool-1",
              callId: "call-1",
              tool: "bash",
              isError: false,
              output: "ok",
            },
          },
        ]}
        active
      />,
    );
    expect(html).toContain('aria-label="Trace run filter"');
    expect(html).toContain("2 events");
    expect(html).toContain("tool_end · bash · ok");
  });

  it("collapses consecutive muted events into a group row", () => {
    const html = renderToStaticMarkup(
      <TracePanel
        sessionId="session-1"
        activeRunId="run-1"
        runs={{ "run-1": { id: "run-1", status: "completed" } }}
        events={[
          {
            sessionId: "session-1",
            runId: "run-1",
            seq: 1,
            emittedAt: 1_700_000_000_000,
            event: {
              type: "run_start",
              userItemId: "user-1",
              prompt: "hello",
            },
          },
          {
            sessionId: "session-1",
            runId: "run-1",
            seq: 2,
            emittedAt: 1_700_000_000_100,
            event: {
              type: "assistant_start",
              turnId: "turn-1",
              itemId: "assistant-1",
            },
          },
          {
            sessionId: "session-1",
            runId: "run-1",
            seq: 3,
            emittedAt: 1_700_000_000_200,
            event: {
              type: "assistant_text_delta",
              turnId: "turn-1",
              itemId: "assistant-1",
              delta: "hi",
            },
          },
          {
            sessionId: "session-1",
            runId: "run-1",
            seq: 4,
            emittedAt: 1_700_000_000_300,
            event: {
              type: "tool_end",
              turnId: "turn-1",
              itemId: "tool-1",
              callId: "call-1",
              tool: "bash",
              isError: false,
              output: "ok",
            },
          },
        ]}
        active
      />,
    );
    expect(html).toContain("2 muted · assistant_start, assistant_text_delta");
    expect(html).not.toContain("assistant_text_delta · +2 chars");
  });
});

describe("TraceEmptyState", () => {
  it("renders placeholder copy", () => {
    const html = renderToStaticMarkup(<TraceEmptyState />);
    expect(html).toContain("开始对话后，运行事件将在此显示。");
  });
});
