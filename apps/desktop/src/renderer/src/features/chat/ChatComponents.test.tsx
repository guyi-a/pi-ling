import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ApprovalTimelineItem,
  AssistantTimelineItem,
  ToolTimelineItem,
} from "../../timeline/reducer";
import { ApprovalCard } from "./ApprovalCard";
import { ApprovalModePicker } from "./ApprovalModePicker";
import { shouldSubmitComposer } from "./ChatView";
import { MessageItem } from "./MessageItem";
import { ToolCard } from "./ToolCard";

describe("chat components", () => {
  it("renders assistant markdown including headings and code", () => {
    const item: AssistantTimelineItem = {
      kind: "assistant",
      id: "assistant",
      runId: "run",
      turnId: "turn",
      createdSeq: 1,
      text: "# 标题\n\n```ts\nconst ok = true\n```",
      thinking: "",
      status: "completed",
      stopReason: "stop",
    };
    const html = renderToStaticMarkup(<MessageItem item={item} />);
    expect(html).toContain("<h1");
    expect(html).toContain("const ok = true");
  });

  it("renders concise tool metadata and states", () => {
    const item: ToolTimelineItem = {
      kind: "tool",
      id: "tool",
      runId: "run",
      turnId: "turn",
      createdSeq: 1,
      callId: "call",
      tool: "run_command",
      arguments: { command: "pnpm test" },
      status: "running",
    };
    const html = renderToStaticMarkup(<ToolCard item={item} />);
    expect(html).toContain("执行命令");
    expect(html).toContain("pnpm test");
    expect(html).toContain("运行中");
  });

  it("compresses resolved approvals and keeps pending actions visible", () => {
    const base: ApprovalTimelineItem = {
      kind: "approval",
      id: "approval",
      runId: "run",
      turnId: "turn",
      createdSeq: 1,
      toolItemId: "tool",
      status: "pending",
      approval: {
        callId: "call",
        tool: "write_file",
        arguments: { path: "a.ts" },
        effect: { kind: "filesystem-write", path: "a.ts" },
        effectDigest: "digest",
        reason: "write",
      },
    };
    expect(
      renderToStaticMarkup(
        <ApprovalCard item={base} onDecision={() => {}} />,
      ),
    ).toContain("仅允许这次");
    expect(
      renderToStaticMarkup(
        <ApprovalCard
          item={{ ...base, status: "approved" }}
          onDecision={() => {}}
        />,
      ),
    ).toContain("已允许");
  });

  it("submits Enter only outside composition and without Shift", () => {
    expect(
      shouldSubmitComposer({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
    expect(
      shouldSubmitComposer({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false);
    expect(
      shouldSubmitComposer({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });

  it("renders all three approval modes", () => {
    const html = renderToStaticMarkup(
      <ApprovalModePicker value="accept-write" onChange={async () => {}} />,
    );
    expect(html).toContain("手动确认");
    expect(html).toContain("接受编辑");
    expect(html).toContain("自动执行");
  });
});
