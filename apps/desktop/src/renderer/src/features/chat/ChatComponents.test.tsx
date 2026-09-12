import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  ApprovalTimelineItem,
  AssistantTimelineItem,
  ToolTimelineItem,
} from "../../timeline/reducer";
import { ApprovalCard } from "./ApprovalCard";
import { ApprovalModePicker } from "./ApprovalModePicker";
import { ComposerModePicker } from "./ComposerModePicker";
import { shouldSubmitComposer } from "./ChatView";
import { Markdown } from "./Markdown";
import { MessageItem } from "./MessageItem";
import { ToolCard } from "./ToolCard";

const CODEX_STACK_DIAGRAM = `\`\`\`text
Renderer (React UI)
   ↕ IPC
Main Process
   └─ CodexAgentSession          apps/desktop/src/main/codex-agent-session.ts
        └─ CodexRuntimeAdapter   packages/codex-runtime/src/codex-runtime.ts
             └─ CodexAppServerClient    codex-app-server-client.ts   ← 语义层
                  └─ CodexAppServerTransport  codex-app-server-transport.ts ← 协议层
                       ↕ stdin/stdout (JSONL)
                  codex app-server --stdio   ← 子进程（Rust 原生二进制）
\`\`\``;

describe("chat components", () => {
  it("preserves multiline ascii diagrams in plain code blocks", () => {
    const html = renderToStaticMarkup(
      <Markdown>{CODEX_STACK_DIAGRAM}</Markdown>,
    );
    expect(html).toContain("markdown-code-block");
    expect(html).toContain("Renderer (React UI)");
    expect(html).toContain("CodexAgentSession");
    expect(html).toContain("↕ IPC");
    expect(html).toContain("codex app-server --stdio");
  });

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
    expect(html).toContain("message-copy-action");
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
    expect(html).toContain("Run");
    expect(html).toContain("pnpm test");
    expect(html).toContain("Running");
    expect(html).toContain("tool-cat-verify");
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
    ).toContain("允许一次");
    expect(
      renderToStaticMarkup(
        <ApprovalCard
          item={{ ...base, status: "approved" }}
          onDecision={() => {}}
        />,
      ),
    ).toContain("Allowed");
    expect(
      renderToStaticMarkup(
        <ApprovalCard
          item={{
            ...base,
            approval: {
              ...base.approval,
              tool: "pwsh",
              arguments: { command: 'Remove-Item -Path "E:\\pi-ling\\b.md"' },
              effect: { kind: "unknown", note: "delete operation requires approval" },
            },
          }}
          onDecision={() => {}}
        />,
      ),
    ).toContain("Remove-Item -Path");
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

  it("renders selected approval mode trigger", () => {
    const html = renderToStaticMarkup(
      <ApprovalModePicker
        value="accept-write"
        open={false}
        onOpenChange={() => {}}
        onChange={async () => {}}
      />,
    );
    expect(html).toContain("接受编辑");
  });

  it("renders selected composer mode trigger", () => {
    const html = renderToStaticMarkup(
      <ComposerModePicker
        value="plan"
        runtimeKind="native"
        open={false}
        onOpenChange={() => {}}
        onChange={async () => {}}
      />,
    );
    expect(html).toContain("Plan");
  });
});
