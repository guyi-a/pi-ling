import { describe, expect, it, vi } from "vitest";

import { createSpawnSubagentTool } from "../src/subagents/tool.js";
import type { SubagentRuntime } from "../src/subagents/runtime.js";

describe("spawn_subagent tool", () => {
  it("returns foreground summary from runtime", async () => {
    const runtime: SubagentRuntime = {
      spawn: vi.fn(async () => ({
        childSessionId: "child-session",
        childRunId: "child-run",
        summary: "Found auth middleware in src/auth.ts",
      })),
    };
    const tool = createSpawnSubagentTool(runtime);
    const result = await tool.execute(
      "call-1",
      {
        description: "Explore auth",
        prompt: "Find where auth is implemented.",
        run_in_background: false,
      },
      new AbortController().signal,
    );
    expect(runtime.spawn).toHaveBeenCalledOnce();
    const text = result.content.find((block) => block.type === "text")?.text;
    expect(text).toContain("Found auth middleware");
    expect(text).toContain("foreground");
  });

  it("returns background task id from runtime", async () => {
    const runtime: SubagentRuntime = {
      spawn: vi.fn(async () => ({
        taskId: "task-123",
        status: "pending",
      })),
    };
    const tool = createSpawnSubagentTool(runtime);
    const result = await tool.execute(
      "call-2",
      {
        description: "Scan repo",
        prompt: "List major packages.",
        run_in_background: true,
      },
      new AbortController().signal,
    );
    const text = result.content.find((block) => block.type === "text")?.text;
    expect(text).toContain("task-123");
    expect(text).toContain("background");
  });
});
