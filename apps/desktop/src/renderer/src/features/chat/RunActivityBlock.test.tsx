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

  it("shows read-only tools inline while keeping details collapsed", () => {
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
    expect(html).toContain("Glob");
    expect(html).toContain("*.md");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("run-activity-tools-inline");
    expect(html).not.toContain("run-activity-details");
    expect(html).not.toContain("I will list markdown files.");
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

