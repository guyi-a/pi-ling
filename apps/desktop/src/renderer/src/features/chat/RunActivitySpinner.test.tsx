import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RunActivityModel } from "../../run-activity/types";
import { RunActivityBlock } from "./RunActivityBlock";

function activity(patch: Partial<RunActivityModel> = {}): RunActivityModel {
  return {
    runId: "run",
    lifecycle: "running",
    viewMode: "active",
    phase: "planning",
    counters: {
      editedFiles: [],
      exploredFiles: [],
      subagents: [],
      commandCount: 0,
      toolCount: 0,
      failedToolCount: 0,
      approvalCount: 0,
      pendingApprovalCount: 0,
    },
    summary: "",
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

/** 转圈与「占位空格」复用同一位置：有 spacer 说明没有转圈。 */
function hasSpinner(html: string): boolean {
  return !html.includes("run-activity-status-spacer");
}

describe("RunActivityBlock live spinner", () => {
  it("spins on a cold start before any tool call", () => {
    const html = renderToStaticMarkup(<RunActivityBlock activity={activity()} />);
    expect(html).toContain("Planning next steps");
    expect(hasSpinner(html)).toBe(true);
  });

  it("spins while the model thinks after tools have already run", () => {
    // 回归：这里过去被 summary 判断挡掉，导致只有文字没有转圈
    const html = renderToStaticMarkup(
      <RunActivityBlock
        activity={activity({
          summary: "Used 3 tools",
          counters: { ...activity().counters, toolCount: 3 },
          hasUnsettledWork: false,
        })}
      />,
    );
    expect(html).toContain("Planning next steps");
    expect(hasSpinner(html)).toBe(true);
  });

  it("leaves the slot to the tool card while a tool is in flight", () => {
    const html = renderToStaticMarkup(
      <RunActivityBlock
        activity={activity({
          phase: "exploring",
          currentAction: { verb: "Reading", target: "src/main.ts" },
          summary: "Explored 1 file",
          hasUnsettledWork: true,
        })}
      />,
    );
    expect(html).toContain("Reading");
    expect(hasSpinner(html)).toBe(false);
  });

  it("does not spin while waiting for user approval", () => {
    const html = renderToStaticMarkup(
      <RunActivityBlock
        activity={activity({
          phase: "awaiting_approval",
          currentAction: { verb: "Approval required", target: "write a.ts" },
          summary: "Edited 1 file",
          hasUnsettledWork: true,
        })}
      />,
    );
    expect(hasSpinner(html)).toBe(false);
  });
});
