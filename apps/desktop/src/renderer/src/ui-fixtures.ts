import type { AgentStatus, SessionSummary } from "@pi-ling/contracts";

import type { TimelineState } from "./timeline/reducer";
import { createTimelineState } from "./timeline/reducer";

export type UiFixtureName =
  | "empty"
  | "markdown"
  | "tool"
  | "approval"
  | "long";

export interface UiFixture {
  status: AgentStatus;
  sessions: SessionSummary[];
  timeline: TimelineState;
}

export function createUiFixture(name: UiFixtureName): UiFixture {
  const now = Date.now();
  const session: SessionSummary = {
    id: "fixture-session",
    title: name === "empty" ? "新会话" : "重构 API 客户端",
    workspace: { root: "E:\\pi-ling", name: "pi-ling" },
    lifecycle: name === "approval" ? "awaiting_approval" : "idle",
    approvalMode: "manual",
    createdAt: now - 3_600_000,
    updatedAt: now - 120_000,
  };
  const other: SessionSummary = {
    ...session,
    id: "fixture-other",
    title: "检查测试失败",
    lifecycle: "crashed",
    updatedAt: now - 7_200_000,
  };
  const status: AgentStatus = {
    sessionId: session.id,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    configured: true,
    approvalMode: "manual",
    workspace: session.workspace,
  };
  const timeline = createTimelineState();
  timeline.sessionId = session.id;
  if (name !== "empty") {
    timeline.items.push(
      {
        kind: "user",
        id: "user",
        runId: "run",
        createdSeq: 1,
        text: "检查 API 客户端的错误处理，并补充一个回归测试。",
      },
      {
        kind: "assistant",
        id: "assistant-final",
        runId: "run",
        turnId: "run:turn:2",
        createdSeq: 8,
        text:
          name === "long"
            ? longMarkdown
            : "已定位到请求重试时丢失原始错误的问题。\n\n## 修改内容\n\n- 保留上游状态码\n- 补充超时分支\n- 新增回归测试\n\n```ts\nthrow new ClientError(message, { cause, status })\n```",
        thinking: "",
        status: "completed",
        stopReason: "stop",
        usage: {
          input: 2840,
          output: 386,
          totalTokens: 3226,
          cost: 0.0012,
        },
      },
    );
  }
  if (name === "tool" || name === "approval") {
    timeline.items.splice(1, 0, {
      kind: "assistant",
      id: "assistant-tool",
      runId: "run",
      turnId: "run:turn:1",
      createdSeq: 2,
      text: "",
      thinking: "先读取实现和现有测试，再修改错误包装逻辑。",
      status: "completed",
      stopReason: "toolUse",
    });
    timeline.items.splice(2, 0, {
      kind: "tool",
      id: "tool",
      runId: "run",
      turnId: "run:turn:1",
      createdSeq: 3,
      callId: "tool",
      tool: "edit_file",
      arguments: {
        path: "src/client.ts",
        oldText: "throw error",
        newText: "throw new ClientError(error.message, { cause: error })",
      },
      status: name === "approval" ? "awaiting-approval" : "running",
    });
  }
  if (name === "approval") {
    timeline.items.splice(3, 0, {
      kind: "approval",
      id: "tool:approval",
      runId: "run",
      turnId: "run:turn:1",
      createdSeq: 4,
      toolItemId: "tool",
      status: "pending",
      approval: {
        callId: "tool",
        tool: "edit_file",
        arguments: {
          path: "src/client.ts",
          oldText: "throw error",
          newText: "throw new ClientError(error.message, { cause: error })",
        },
        effect: {
          kind: "filesystem-write",
          path: "E:\\pi-ling\\src\\client.ts",
        },
        effectDigest: "fixture",
        reason: "edit E:\\pi-ling\\src\\client.ts",
      },
    });
  }
  if (name === "tool" || name === "approval") {
    timeline.items = timeline.items.filter(
      (item) => item.id !== "assistant-final",
    );
  }
  return { status, sessions: [session, other], timeline };
}

const longMarkdown = `
完成了请求层的错误处理重构，并保留了原始错误链。

## 关键变化

错误现在携带稳定的状态码、请求标识和原始 \`cause\`，调用方不需要再解析字符串。

| 场景 | 之前 | 现在 |
| --- | --- | --- |
| 网络超时 | 普通 Error | ClientTimeoutError |
| 4xx 响应 | 丢失状态码 | 保留 status |
| 重试失败 | 仅最后一次错误 | 保留 cause |

\`\`\`ts
export class ClientError extends Error {
  constructor(
    message: string,
    readonly details: { status?: number; cause?: unknown },
  ) {
    super(message, { cause: details.cause })
  }
}
\`\`\`

测试覆盖了超时、非 JSON 错误体和重试耗尽三个分支。
`.trim();
