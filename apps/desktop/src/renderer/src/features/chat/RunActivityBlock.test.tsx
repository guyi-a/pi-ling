import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RunActivityModel } from "../../run-activity/types";
import { RunActivityBlock } from "./RunActivityBlock";

function activity(
  patch: Partial<RunActivityModel> = {},
): RunActivityModel {
  return {
    runId: "run",
    lifecycle: "running",
    viewMode: "active",
    phase: "verifying",
    currentAction: { verb: "Running", target: "pnpm test" },
    counters: {
      editedFiles: ["a.ts"],
      exploredFiles: ["a.ts", "b.ts"],
      subagents: [],
      commandCount: 1,
      toolCount: 1,
      failedToolCount: 0,
      approvalCount: 0,
      pendingApprovalCount: 0,
      additions: 12,
      deletions: 3,
    },
    summary: "Edited 1 file, explored 2 files, ran 1 command",
    tools: [],
    approvals: [],
    changes: [],
    thinking: "",
    segments: [],
    workSegments: [],
    hasUnsettledWork: false,
    hasActivity: true,
    hasBlockingApproval: false,
    ...patch,
  };
}

describe("RunActivityBlock", () => {
  it("renders a collapsed live summary and current operation", () => {
    const html = renderToStaticMarkup(
      <RunActivityBlock activity={activity()} />,
    );
    expect(html).toContain("Edited 1 file");
    expect(html).not.toContain("Working");
    expect(html).toContain("pnpm test");
    expect(html).not.toContain("Thinking");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("run-activity-details");
  });

  it("keeps completed details collapsed by default", () => {
    const completed = activity({
      lifecycle: "completed",
      viewMode: "settled",
      phase: "completed",
    });
    delete completed.currentAction;
    const html = renderToStaticMarkup(
      <RunActivityBlock
        activity={completed}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("run-activity-details");
  });

  it("shows tool history only after the summary is expanded", () => {
    const assistant = {
      kind: "assistant" as const,
      id: "assistant",
      runId: "run",
      turnId: "turn",
      createdSeq: 1,
      text: "I will inspect it.",
      thinking: "",
      status: "completed" as const,
      stopReason: "toolUse",
    };
    const tool = {
      kind: "tool" as const,
      id: "tool",
      runId: "run",
      turnId: "turn",
      createdSeq: 2,
      callId: "tool",
      tool: "read_file",
      arguments: { path: "agent.md" },
      status: "running" as const,
    };
    const model = activity({
      tools: [tool],
      segments: [
        {
          turnId: "turn",
          content: assistant.text,
          assistant,
          tools: [tool],
        },
      ],
      workSegments: [],
    });
    const collapsed = renderToStaticMarkup(
      <RunActivityBlock
        activity={model}
      />,
    );
    expect(collapsed).not.toContain("agent.md");
    expect(collapsed).not.toContain("I will inspect it.");

    const expanded = renderToStaticMarkup(
      <RunActivityBlock
        activity={model}
        forceOpen
      />,
    );
    expect(expanded).toContain("Read");
    expect(expanded).toContain("agent.md");
    expect(expanded).toContain("I will inspect it.");
  });

  it("does not invent an activity summary without tools", () => {
    const html = renderToStaticMarkup(
      <RunActivityBlock
        activity={activity({
          summary: "",
          tools: [],
          thinking: "considering",
          currentAction: undefined,
        })}
      />,
    );
    expect(html).toContain("Thinking");
    expect(html).not.toContain("Thought through the task");
    expect(html).not.toContain("run-activity-summary");
  });

  it("keeps settled tool runs collapsed until expanded", () => {
    const assistant = {
      kind: "assistant" as const,
      id: "assistant",
      runId: "run",
      turnId: "turn",
      createdSeq: 1,
      text: "I will list markdown files.",
      thinking: "",
      status: "completed" as const,
      stopReason: "toolUse",
    };
    const tool = {
      kind: "tool" as const,
      id: "tool",
      runId: "run",
      turnId: "turn",
      createdSeq: 2,
      callId: "tool",
      tool: "glob",
      arguments: { glob_pattern: "*.md", target_directory: "." },
      status: "completed" as const,
    };
    const model = activity({
      lifecycle: "completed",
      viewMode: "settled",
      phase: "completed",
      summary: "Explored 1 file",
      counters: {
        editedFiles: [],
        exploredFiles: ["*.md"],
        subagents: [],
        commandCount: 0,
        toolCount: 1,
        failedToolCount: 0,
        approvalCount: 0,
        pendingApprovalCount: 0,
      },
      tools: [tool],
      segments: [
        {
          turnId: "turn",
          content: assistant.text,
          assistant,
          tools: [tool],
        },
      ],
      workSegments: [],
    });
    delete model.currentAction;
    const html = renderToStaticMarkup(
      <RunActivityBlock activity={model} />,
    );
    expect(html).toContain("Explored 1 file");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("run-activity-tools-inline");
    expect(html).not.toContain("run-activity-details");
    expect(html).not.toContain("Glob");
    expect(html).not.toContain("I will list markdown files.");
  });

  it("keeps multi-tool summaries collapsed", () => {
    const tools = [1, 2, 3].map((index) => ({
      kind: "tool" as const,
      id: `tool-${index}`,
      runId: "run",
      turnId: "turn",
      createdSeq: index,
      callId: `tool-${index}`,
      tool: "ask_user",
      arguments: { questions: [{ id: "q", question: "Which?" }] },
      status: "completed" as const,
    }));
    const model = activity({
      lifecycle: "completed",
      viewMode: "settled",
      phase: "completed",
      summary: "Used 3 tools",
      counters: {
        editedFiles: [],
        exploredFiles: [],
        subagents: [],
        commandCount: 0,
        toolCount: 3,
        failedToolCount: 0,
        approvalCount: 0,
        pendingApprovalCount: 0,
      },
      tools,
      segments: [],
      workSegments: [],
    });
    delete model.currentAction;
    const html = renderToStaticMarkup(
      <RunActivityBlock activity={model} />,
    );
    expect(html).toContain("Used 3 tools");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("run-activity-tools-inline");
    expect(html).not.toContain("run-activity-details");
    expect(html).not.toContain("ask_user");
  });

  it("keeps failed tool runs collapsed until the summary is expanded", () => {
    const assistant = {
      id: "assistant",
      kind: "assistant" as const,
      runId: "run",
      turnId: "turn",
      createdSeq: 1,
      text: "The tool failed.",
      status: "completed" as const,
    };
    const tool = {
      id: "tool",
      runId: "run",
      turnId: "turn",
      createdSeq: 2,
      callId: "tool",
      tool: "ask_user",
      arguments: {
        questions: [{ id: "mode", question: "Which mode?" }],
      },
      status: "failed" as const,
      output: "CHECK constraint failed: lifecycle",
    };
    const model = activity({
      lifecycle: "completed",
      viewMode: "settled",
      phase: "completed",
      summary: "Used 1 tool",
      counters: {
        editedFiles: [],
        exploredFiles: [],
        subagents: [],
        commandCount: 0,
        toolCount: 1,
        failedToolCount: 1,
        approvalCount: 0,
        pendingApprovalCount: 0,
      },
      tools: [tool],
      segments: [
        {
          turnId: "turn",
          content: assistant.text,
          assistant,
          tools: [tool],
        },
      ],
      workSegments: [],
      finalAssistant: assistant,
    });
    delete model.currentAction;
    const html = renderToStaticMarkup(
      <RunActivityBlock activity={model} />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("run-activity-details");
    expect(html).not.toContain("CHECK constraint failed: lifecycle");

    const expanded = renderToStaticMarkup(
      <RunActivityBlock activity={model} forceOpen />,
    );
    expect(expanded).toContain("run-activity-details");
    // 工具卡片本身也是折叠的：失败以红色 Failed 标出，展开 run 不再顺带
    // 抖出一大段错误正文，需要时再点开该工具。
    expect(expanded).not.toContain("CHECK constraint failed: lifecycle");
    expect(expanded).toMatch(/tool-entry-state">Failed</);
  });

  it("falls back to the phase label when planning with no active tool", () => {
    const planning = activity({
      phase: "planning",
      tools: [],
      thinking: "",
      hasActivity: true,
    });
    delete planning.currentAction;
    const html = renderToStaticMarkup(
      <RunActivityBlock activity={planning} />,
    );
    expect(html).not.toContain("Thinking");
    expect(html).not.toContain("thinking-card");
    expect(html).toContain("Planning next steps");
  });
});

