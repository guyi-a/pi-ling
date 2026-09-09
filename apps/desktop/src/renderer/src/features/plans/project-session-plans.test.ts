import { describe, expect, it } from "vitest";

import type {
  ApprovalTimelineItem,
  ToolTimelineItem,
} from "../../timeline/reducer";
import {
  extractPlanText,
  isExitPlanModeTool,
  isPlanAwaitingBuild,
  isPlanToolName,
  planDisplayTitle,
  projectSessionPlans,
  selectSessionPlan,
  sortedSessionPlans,
} from "./project-session-plans";

function planTool(
  overrides: Partial<ToolTimelineItem> & Pick<ToolTimelineItem, "callId" | "runId">,
): ToolTimelineItem {
  return {
    id: overrides.id ?? overrides.callId,
    kind: "tool",
    turnId: "turn-1",
    tool: "create_plan",
    arguments: {},
    status: "completed",
    createdSeq: 1,
    ...overrides,
  };
}

function approvalItem(
  overrides: Partial<ApprovalTimelineItem> &
    Pick<ApprovalTimelineItem, "id" | "runId" | "toolItemId">,
): ApprovalTimelineItem {
  return {
    kind: "approval",
    turnId: "turn-1",
    createdSeq: 99,
    status: "pending",
    approval: {
      callId: overrides.toolItemId,
      tool: "exit_plan_mode",
      arguments: { plan: "Plan body" },
      effect: { kind: "unknown", note: "plan" },
      effectDigest: "digest-1",
    },
    ...overrides,
  };
}

describe("project-session-plans", () => {
  it("matches plan tool names", () => {
    expect(isPlanToolName("create_plan")).toBe(true);
    expect(isExitPlanModeTool("exit_plan_mode")).toBe(true);
    expect(isPlanToolName("read_file")).toBe(false);
  });

  it("extracts plan text from arguments and output", () => {
    expect(
      extractPlanText({
        arguments: { plan: "Step one" },
      }),
    ).toBe("Step one");
  });

  it("merges create and update plan content within a run", () => {
    const plans = projectSessionPlans([
      planTool({
        callId: "call-1",
        runId: "run-a",
        tool: "create_plan",
        arguments: { plan: "First draft" },
        createdSeq: 1,
      }),
      planTool({
        callId: "call-2",
        runId: "run-a",
        tool: "update_plan",
        arguments: { content: "Final draft" },
        createdSeq: 2,
      }),
    ]);

    expect(plans.get("run-a")).toMatchObject({
      markdown: "Final draft",
      status: "draft",
    });
  });

  it("marks exit_plan_mode awaiting approval as ready with pending approval", () => {
    const items = [
      planTool({
        callId: "call-1",
        runId: "run-a",
        tool: "create_plan",
        arguments: { plan: "Plan body" },
        createdSeq: 1,
      }),
      planTool({
        callId: "call-2",
        runId: "run-a",
        tool: "exit_plan_mode",
        arguments: { plan: "Plan body" },
        status: "awaiting-approval",
        createdSeq: 2,
      }),
      approvalItem({
        id: "approval-1",
        runId: "run-a",
        toolItemId: "call-2",
      }),
    ];
    const plans = projectSessionPlans(items, { "run-a": { id: "run-a", status: "running" } });

    expect(plans.get("run-a")).toMatchObject({
      status: "ready",
      pendingApproval: {
        approvalItemId: "approval-1",
        callId: "call-2",
        effectDigest: "digest-1",
      },
    });
  });

  it("marks completed exit_plan_mode with running run as building", () => {
    const plans = projectSessionPlans(
      [
        planTool({
          callId: "call-2",
          runId: "run-a",
          tool: "exit_plan_mode",
          arguments: { plan: "Plan body" },
          status: "completed",
          createdSeq: 2,
        }),
      ],
      { "run-a": { id: "run-a", status: "running" } },
    );

    expect(plans.get("run-a")?.status).toBe("building");
  });

  it("marks completed exit_plan_mode with completed run as built", () => {
    const plans = projectSessionPlans(
      [
        planTool({
          callId: "call-2",
          runId: "run-a",
          tool: "exit_plan_mode",
          arguments: { plan: "Plan body" },
          status: "completed",
          createdSeq: 2,
        }),
      ],
      { "run-a": { id: "run-a", status: "completed" } },
    );

    expect(plans.get("run-a")?.status).toBe("built");
  });

  it("detects awaiting build tools", () => {
    const awaiting = isPlanAwaitingBuild([
      planTool({
        callId: "call-2",
        runId: "run-a",
        tool: "exit_plan_mode",
        status: "awaiting-approval",
      }),
    ]);
    expect(awaiting?.callId).toBe("call-2");
  });

  it("isolates plans by run", () => {
    const plans = projectSessionPlans([
      planTool({
        callId: "call-1",
        runId: "run-a",
        arguments: { plan: "Run A" },
        createdSeq: 1,
      }),
      planTool({
        callId: "call-2",
        runId: "run-b",
        arguments: { plan: "Run B" },
        createdSeq: 2,
      }),
    ]);

    expect(plans.get("run-a")?.markdown).toBe("Run A");
    expect(plans.get("run-b")?.markdown).toBe("Run B");
  });

  it("marks native create_plan with completed planning run as ready", () => {
    const plans = projectSessionPlans(
      [
        planTool({
          callId: "call-1",
          runId: "run-a",
          tool: "create_plan",
          arguments: { plan: "Native plan" },
          status: "completed",
          createdSeq: 1,
        }),
      ],
      { "run-a": { id: "run-a", status: "completed" } },
    );

    expect(plans.get("run-a")).toMatchObject({
      status: "ready",
      markdown: "Native plan",
      pendingApproval: undefined,
    });
  });

  it("marks native plan as building when build run is running", () => {
    const buildRunByPlanRunId = new Map([["run-a", "run-build"]]);
    const plans = projectSessionPlans(
      [
        planTool({
          callId: "call-1",
          runId: "run-a",
          tool: "create_plan",
          arguments: { plan: "Native plan" },
          status: "completed",
          createdSeq: 1,
        }),
      ],
      {
        "run-a": { id: "run-a", status: "completed" },
        "run-build": { id: "run-build", status: "running" },
      },
      { buildRunByPlanRunId },
    );

    expect(plans.get("run-a")).toMatchObject({
      status: "building",
      buildRunId: "run-build",
    });
  });

  it("marks native plan as built when build run completes", () => {
    const buildRunByPlanRunId = new Map([["run-a", "run-build"]]);
    const plans = projectSessionPlans(
      [
        planTool({
          callId: "call-1",
          runId: "run-a",
          tool: "create_plan",
          arguments: { plan: "Native plan" },
          status: "completed",
          createdSeq: 1,
        }),
      ],
      {
        "run-a": { id: "run-a", status: "completed" },
        "run-build": { id: "run-build", status: "completed" },
      },
      { buildRunByPlanRunId },
    );

    expect(plans.get("run-a")?.status).toBe("built");
  });

  it("derives plan title from markdown heading", () => {
    const plans = projectSessionPlans([
      planTool({
        callId: "call-1",
        runId: "run-a",
        arguments: { plan: "# Example Plan\n\nBody" },
        createdSeq: 1,
      }),
    ]);

    const plan = plans.get("run-a");
    expect(plan).toBeDefined();
    expect(planDisplayTitle(plan!)).toBe("Example Plan");
  });

  it("sorts plans by updatedAt descending", () => {
    const plans = projectSessionPlans([
      planTool({
        callId: "call-1",
        runId: "run-a",
        arguments: { plan: "A" },
        createdSeq: 1,
      }),
      planTool({
        callId: "call-2",
        runId: "run-b",
        arguments: { plan: "B" },
        createdSeq: 3,
      }),
    ]);

    expect(sortedSessionPlans(plans).map((plan) => plan.runId)).toEqual([
      "run-b",
      "run-a",
    ]);
  });

  it("selects the active run plan", () => {
    const plans = projectSessionPlans([
      planTool({
        callId: "call-1",
        runId: "run-a",
        arguments: { plan: "Run A" },
        createdSeq: 1,
      }),
      planTool({
        callId: "call-2",
        runId: "run-b",
        arguments: { plan: "Run B" },
        createdSeq: 2,
      }),
    ]);

    expect(
      selectSessionPlan(
        plans,
        { "run-b": { id: "run-b", status: "running" } },
        "active",
        "run-b",
      )?.markdown,
    ).toBe("Run B");
  });
});
