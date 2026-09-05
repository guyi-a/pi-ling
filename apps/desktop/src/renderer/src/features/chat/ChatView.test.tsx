import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TimelineItem } from "../../timeline/reducer";
import { ChatView } from "./ChatView";

describe("ChatView", () => {
  it("renders execution, approval and the next assistant turn in timeline order", () => {
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
      {
        kind: "assistant",
        id: "turn-2:assistant",
        runId: "run-1",
        turnId: "turn-2",
        createdSeq: 4,
        text: "done",
        thinking: "",
        status: "completed",
        stopReason: "stop",
      },
    ];

    const html = renderToStaticMarkup(
      <ChatView
        items={items}
        modelLabel="model"
        workspaceReady
        activeRunId={null}
        onSend={async () => {}}
        onCancel={() => {}}
        onApproval={async () => {}}
      />,
    );

    expect(html.indexOf("执行过程")).toBeLessThan(
      html.indexOf("需要确认"),
    );
    expect(html.indexOf("需要确认")).toBeLessThan(
      html.indexOf("done"),
    );
  });
});
