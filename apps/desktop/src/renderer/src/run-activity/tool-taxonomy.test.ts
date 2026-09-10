import { describe, expect, it } from "vitest";

import type { ToolTimelineItem } from "../timeline/reducer";
import {
  classifyTool,
  toolAction,
  toolLabel,
  toolNameLabel,
  subagentToolPresentation,
  toolTarget,
} from "./tool-taxonomy";

function tool(
  name: string,
  arguments_: Record<string, unknown>,
): ToolTimelineItem {
  return {
    kind: "tool",
    id: "call-1",
    runId: "run-1",
    turnId: "turn-1",
    createdSeq: 1,
    callId: "call-1",
    tool: name,
    arguments: arguments_,
    status: "completed",
  };
}

describe("tool-taxonomy", () => {
  it("labels common DSH tool names", () => {
    expect(toolNameLabel("str_replace_editor")).toBe("Edit");
    expect(toolNameLabel("read_image")).toBe("Read image");
    expect(toolNameLabel("pwsh")).toBe("Run");
    expect(toolNameLabel("delete")).toBe("Delete");
    expect(toolNameLabel("glob")).toBe("Glob");
    expect(toolNameLabel("list_files")).toBe("List");
    expect(toolNameLabel("todo_write")).toBe("Todo");
    expect(toolNameLabel("web_search")).toBe("Web search");
    expect(toolNameLabel("subagent_fork")).toBe("Subagent");
    expect(toolNameLabel("exit_plan_mode")).toBe("Plan");
    expect(toolNameLabel("create_goal")).toBe("Goal");
    expect(toolNameLabel("skill")).toBe("Skill");
    expect(toolNameLabel("job_list")).toBe("Job");
    expect(toolNameLabel("workflow")).toBe("Workflow");
    expect(toolNameLabel("ralph")).toBe("Loop");
    expect(toolNameLabel("list_agents")).toBe("Agent");
  });

  it("extracts DSH argument shapes for targets", () => {
    expect(
      toolTarget(tool("write", { file_path: "apps/desktop/src/App.tsx" })),
    ).toBe("apps/desktop/src/App.tsx");

    expect(
      toolTarget(tool("bash", { command: "pnpm test" })),
    ).toBe("pnpm test");

    expect(
      toolTarget(tool("glob", { glob_pattern: "**/*.ts", target_directory: "." })),
    ).toBe("**/*.ts");

    expect(
      toolTarget(
        tool("str_replace_editor", {
          file_path: "b.md",
          old_string: "hi",
          new_string: "hiworld",
        }),
      ),
    ).toBe("b.md");

    expect(
      toolTarget(tool("web_search", { search_term: "vitest mock" })),
    ).toBe("vitest mock");

    expect(
      toolTarget(tool("subagent", { task: "explore auth module" })),
    ).toBe("explore auth module");
  });

  it("formats subagent outer copy for foreground and background", () => {
    const foreground = subagentToolPresentation(
      tool("spawn_subagent", {
        description: "Summarize README",
        run_in_background: false,
      }),
    );
    expect(foreground).toMatchObject({
      label: "Subagent",
      target: "Summarize README",
      statusText: "Done",
      verb: "Delegated to subagent",
    });

    const backgroundQueued = subagentToolPresentation(
      tool("spawn_subagent", {
        description: "Scan agent-core",
        run_in_background: true,
      }),
      "pending",
    );
    expect(backgroundQueued).toMatchObject({
      label: "Subagent",
      target: "Background · Scan agent-core",
      statusText: "Queued",
      verb: "Queued background subagent",
    });
  });

  it("classifies meta, network, and agent tools", () => {
    expect(classifyTool(tool("todo_write", {}))).toBe("meta");
    expect(classifyTool(tool("web_search", {}))).toBe("network");
    expect(classifyTool(tool("subagent", {}))).toBe("subagent");
    expect(classifyTool(tool("grep", {}))).toBe("explore");
  });

  it("uses descriptive verbs for meta and agent tools", () => {
    expect(toolAction(tool("todo_write", { content: "ship feature" })).verb).toBe(
      "Updating todos",
    );
    expect(toolAction(tool("subagent", { task: "scan repo" })).verb).toBe(
      "Delegated to subagent",
    );
  });

  it("prefers path over generic tool name in tool rows", () => {
    expect(
      toolLabel(tool("Read file", { path: "README.md" })),
    ).toBe("Read");
    expect(toolTarget(tool("Read file", { path: "README.md" }))).toBe(
      "README.md",
    );
  });
});
