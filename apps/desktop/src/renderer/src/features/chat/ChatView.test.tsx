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
        workspaceReady
        configured
        activeRunId={null}
        approvalMode="manual"
        composerMode="agent"
        runtimeKind="native"
        availableRuntimes={["native", "dsh"]}
        onSend={async () => {}}
        onCancel={() => {}}
        onApproval={async () => {}}
        onQuestion={async () => {}}
        onApprovalModeChange={async () => {}}
        onComposerModeChange={async () => {}}
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
        workspaceReady
        configured
        activeRunId={null}
        approvalMode="manual"
        composerMode="agent"
        runtimeKind="native"
        availableRuntimes={["native"]}
        onSend={async () => {}}
        onCancel={() => {}}
        onApproval={async () => {}}
        onQuestion={async () => {}}
        onApprovalModeChange={async () => {}}
        onComposerModeChange={async () => {}}
        onRuntimeChange={() => {}}
      />,
    );
    expect(html).not.toContain("I will inspect the project.");
    expect(html).toContain("This is the final answer.");
  });

  it("renders pending question dock in the composer", () => {
    const items: TimelineItem[] = [
      {
        kind: "question",
        id: "call-1:question",
        runId: "run-1",
        turnId: "turn-1",
        createdSeq: 1,
        toolItemId: "call-1",
        status: "pending",
        question: {
          callId: "call-1",
          questions: [
            {
              id: "mode",
              question: "Which mode?",
              options: [{ label: "Agent" }, { label: "Plan" }],
            },
          ],
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
        workspaceReady
        configured
        activeRunId="run-1"
        approvalMode="manual"
        composerMode="agent"
        runtimeKind="native"
        availableRuntimes={["native"]}
        onSend={async () => {}}
        onCancel={() => {}}
        onApproval={async () => {}}
        onQuestion={async () => {}}
        onApprovalModeChange={async () => {}}
        onComposerModeChange={async () => {}}
        onRuntimeChange={() => {}}
      />,
    );
    expect(html).toContain("Questions");
    expect(html).toContain("Which mode?");
    expect(html).toContain("Other...");
  });
});
