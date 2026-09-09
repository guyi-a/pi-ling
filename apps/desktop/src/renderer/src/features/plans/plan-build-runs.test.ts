import { describe, expect, it } from "vitest";

import type { TimelineItem } from "../../timeline/reducer";
import {
  buildPlanPrompt,
  extractBuildPlanMarkdown,
  inferPlanBuildRunsFromTimeline,
} from "./plan-build-runs";
import { projectSessionPlans } from "./project-session-plans";

describe("plan-build-runs", () => {
  it("extracts plan markdown from build prompt text", () => {
    const markdown = "# Example Plan\n\nBody";
    const prompt = buildPlanPrompt(markdown);
    expect(extractBuildPlanMarkdown(prompt)).toBe(markdown);
  });

  it("infers plan run to build run mapping from timeline", () => {
    const planMarkdown = "# Example Plan\n\nBody";
    const items: TimelineItem[] = [
      {
        id: "tool-1",
        kind: "tool",
        runId: "run-plan",
        turnId: "turn-1",
        callId: "call-1",
        tool: "create_plan",
        arguments: { plan: planMarkdown },
        status: "completed",
        createdSeq: 1,
      },
      {
        id: "user-1",
        kind: "user",
        runId: "run-build",
        text: buildPlanPrompt(planMarkdown),
        createdSeq: 2,
      },
    ];

    expect(inferPlanBuildRunsFromTimeline(items)).toEqual(
      new Map([["run-plan", "run-build"]]),
    );

    const plans = projectSessionPlans(items, {
      "run-plan": { id: "run-plan", status: "completed" },
      "run-build": { id: "run-build", status: "completed" },
    }, {
      buildRunByPlanRunId: inferPlanBuildRunsFromTimeline(items),
    });

    expect(plans.get("run-plan")?.status).toBe("built");
  });
});
