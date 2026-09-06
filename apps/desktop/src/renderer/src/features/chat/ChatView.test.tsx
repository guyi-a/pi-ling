import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TimelineItem } from "../../timeline/reducer";
import { ChatView } from "./ChatView";

describe("ChatView", () => {
  it("renders pending approval inside its run activity", () => {
    const items: TimelineItem[] = [
      {
        kind: "assistant",
        id: "turn-1:assistant",
        runId: "run-1",
        turnId: "turn-1",
        createdSeq: 1,
        text: "",
        thinking: "inspect first",
        status: "completed",
        stopReason: "toolUse",
      },
      {
        kind: "tool",
        id: "call-1",
        runId: "run-1",
        turnId: "turn-1",
        createdSeq: 2,
        callId: "call-1",
        tool: "write_file",
        arguments: { path: "a.txt" },
        status: "awaiting-approval",
      },
      {
        kind: "approval",
        id: "call-1:approval",
        runId: "run-1",
        turnId: "turn-1",
        createdSeq: 3,
        toolItemId: "call-1",
        status: "pending",
        approval: {
          callId: "call-1",
          tool: "write_file",
          arguments: { path: "a.txt" },
          effect: { kind: "filesystem-write" },
          effectDigest: "digest",
          reason: "write a.txt",
        },
      },
    ];

    const html = renderToStaticMarkup(
      <ChatView
        sessionId="session"
        items={items}
        runs={{ "run-1": { id: "run-1", status: "running" } }}
        liveMessageIds={new Set()}
        onMessagePresented={() => {}}
        modelLabel="model"
        workspaceReady
        activeRunId={null}
        approvalMode="manual"
        runtimeKind="native"
        availableRuntimes={["native", "dsh"]}
        onSend={async () => {}}
        onCancel={() => {}}
        onApproval={async () => {}}
        onApprovalModeChange={async () => {}}
        onRuntimeChange={() => {}}
      />,
    );

    expect(html.indexOf("Run activity")).toBeLessThan(
      html.indexOf("Approval required"),
    );
  });

  it("keeps tool preambles inside collapsed activity details", () => {
    const items: TimelineItem[] = [
      {
        kind: "assistant",
        id: "preamble",
        runId: "run",
        turnId: "turn-1",
        createdSeq: 1,
        text: "I will inspect the project.",
        thinking: "",
        status: "completed",
        stopReason: "toolUse",
      },
      {
        kind: "tool",
        id: "read",
        runId: "run",
        turnId: "turn-1",
        createdSeq: 2,
        callId: "read",
        tool: "read_file",
        arguments: { path: "agent.md" },
        status: "completed",
      },
      {
        kind: "assistant",
        id: "final",
        runId: "run",
        turnId: "turn-2",
        createdSeq: 3,
        text: "This is the final answer.",
        thinking: "",
        status: "completed",
        stopReason: "stop",
      },
    ];
    const html = renderToStaticMarkup(
      <ChatView
        sessionId="session"
        items={items}
        runs={{ run: { id: "run", status: "completed" } }}
        liveMessageIds={new Set()}
        onMessagePresented={() => {}}
        modelLabel="model"
        workspaceReady
        activeRunId={null}
        approvalMode="manual"
        runtimeKind="native"
        availableRuntimes={["native"]}
        onSend={async () => {}}
        onCancel={() => {}}
        onApproval={async () => {}}
        onApprovalModeChange={async () => {}}
        onRuntimeChange={() => {}}
      />,
    );
    expect(html).not.toContain("I will inspect the project.");
    expect(html).toContain("This is the final answer.");
  });
});
