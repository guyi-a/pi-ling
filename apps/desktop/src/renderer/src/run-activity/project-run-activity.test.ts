import type {
  ApprovalTimelineItem,
  TimelineItem,
  TimelineRun,
} from "../timeline/reducer";
import { describe, expect, it } from "vitest";

import { projectRunActivities } from "./project-run-activity";
import { toolAction, toolLabel } from "./tool-taxonomy";

function project(items: TimelineItem[], status: TimelineRun["status"] = "running") {
  return projectRunActivities({
    items,
    runs: { run: { id: "run", status } },
  })[0]!;
}

describe("projectRunActivities", () => {
  it("aggregates tools by run with path dedupe and verification phase", () => {
    const activity = project([
      {
        kind: "user",
        id: "user",
        runId: "run",
        createdSeq: 1,
        text: "work",
      },
      {
        kind: "tool",
        id: "read-1",
        runId: "run",
        turnId: "turn",
        createdSeq: 2,
        callId: "read-1",
        tool: "read_file",
        arguments: { path: "src/a.ts" },
        status: "completed",
      },
      {
        kind: "tool",
        id: "read-2",
        runId: "run",
        turnId: "turn",
        createdSeq: 3,
        callId: "read-2",
        tool: "Read file",
        arguments: { path: "src\\a.ts" },
        status: "completed",
      },
      {
        kind: "tool",
        id: "edit",
        runId: "run",
        turnId: "turn",
        createdSeq: 4,
        callId: "edit",
        tool: "edit_file",
        arguments: { path: "src/a.ts" },
        status: "completed",
      },
      {
        kind: "tool",
        id: "verify",
        runId: "run",
        turnId: "turn",
        createdSeq: 5,
        callId: "verify",
        tool: "run_command",
        arguments: { command: "pnpm test" },
        status: "running",
      },
    ]);
    expect(activity.counters).toMatchObject({
      editedFiles: ["src/a.ts"],
      exploredFiles: ["src/a.ts"],
      commandCount: 1,
    });
    expect(activity.phase).toBe("verifying");
    expect(activity.viewMode).toBe("active");
    expect(activity.currentAction).toMatchObject({
      verb: "Running",
      target: "pnpm test",
    });
  });

  it("prioritizes pending approval and accumulates diff lines", () => {
    const approval: ApprovalTimelineItem = {
      kind: "approval",
      id: "approval",
      runId: "run",
      turnId: "turn",
      createdSeq: 3,
      toolItemId: "tool",
      status: "pending",
      approval: {
        callId: "tool",
        tool: "edit_file",
        arguments: { path: "a.ts" },
        effect: { kind: "filesystem-write", path: "a.ts" },
        effectDigest: "digest",
        reason: "write",
      },
    };
    const activity = project([
      {
        kind: "tool",
        id: "tool",
        runId: "run",
        turnId: "turn",
        createdSeq: 2,
        callId: "tool",
        tool: "edit_file",
        arguments: { path: "a.ts" },
        status: "awaiting-approval",
      },
      approval,
      {
        kind: "changes",
        id: "changes",
        runId: "run",
        turnId: "turn",
        createdSeq: 4,
        callId: "tool",
        files: [
          {
            path: "a.ts",
            status: "modified",
            binary: false,
            sensitive: false,
            tooLarge: false,
            additions: 12,
            deletions: 3,
          },
        ],
      },
    ]);
    expect(activity.phase).toBe("awaiting_approval");
    expect(activity.counters).toMatchObject({
      additions: 12,
      deletions: 3,
      pendingApprovalCount: 1,
    });
  });

  it("hides empty completed chat activity and separates final assistant", () => {
    const activity = project(
      [
        {
          kind: "assistant",
          id: "assistant",
          runId: "run",
          turnId: "turn",
          createdSeq: 2,
          text: "answer",
          thinking: "",
          status: "completed",
          stopReason: "stop",
        },
      ],
      "completed",
    );
    expect(activity.hasActivity).toBe(false);
    expect(activity.finalAssistant?.text).toBe("answer");
    expect(activity.phase).toBe("completed");
    expect(activity.viewMode).toBe("settled");
  });

  it("keeps a completed run active until presentation catches up", () => {
    const assistant: TimelineItem = {
      kind: "assistant",
      id: "answer",
      runId: "run",
      turnId: "turn",
      createdSeq: 2,
      text: "answer",
      thinking: "",
      status: "completed",
      stopReason: "stop",
    };
    const activity = projectRunActivities({
      items: [assistant],
      runs: { run: { id: "run", status: "completed" } },
      presentingMessageIds: new Set(["answer"]),
    })[0]!;
    expect(activity.viewMode).toBe("active");
    expect(activity.finalAssistant?.id).toBe("answer");
  });

  it("counts only presented tools and exposes the paced operation", () => {
    const tools: TimelineItem[] = [
      {
        kind: "tool",
        id: "read-a",
        runId: "run",
        turnId: "turn",
        createdSeq: 1,
        callId: "read-a",
        tool: "read_file",
        arguments: { path: "a.ts" },
        status: "completed",
      },
      {
        kind: "tool",
        id: "read-b",
        runId: "run",
        turnId: "turn",
        createdSeq: 2,
        callId: "read-b",
        tool: "read_file",
        arguments: { path: "b.ts" },
        status: "running",
      },
    ];
    const activity = projectRunActivities({
      items: tools,
      runs: { run: { id: "run", status: "running" } },
      visibleToolIds: new Set(["read-a"]),
      presentingRunIds: new Set(["run"]),
      currentToolId: "read-a",
    })[0]!;
    expect(activity.summary).toBe("Explored 1 file");
    expect(activity.counters.exploredFiles).toEqual(["a.ts"]);
    expect(activity.currentAction).toMatchObject({
      verb: "Reading",
      target: "a.ts",
    });
  });

  it("summarizes a foreground subagent on the outer run activity row", () => {
    const activity = project([
      {
        kind: "tool",
        id: "subagent",
        runId: "run",
        turnId: "turn",
        createdSeq: 1,
        callId: "subagent",
        tool: "spawn_subagent",
        arguments: {
          description: "Summarize project files",
          prompt: "Read README and package.json.",
        },
        status: "completed",
      },
    ], "completed");
    expect(activity.summary).toBe("Subagent · 1");
  });

  it("summarizes subagent from allTools even when not yet visible", () => {
    const activity = projectRunActivities({
      items: [
        {
          kind: "tool",
          id: "subagent",
          runId: "run",
          turnId: "turn",
          createdSeq: 1,
          callId: "subagent",
          tool: "spawn_subagent",
          arguments: {
            description: "Summarize project files",
            prompt: "Read README and package.json.",
          },
          status: "running",
        },
      ],
      runs: { run: { id: "run", status: "running" } },
      visibleToolIds: new Set(),
      presentingRunIds: new Set(["run"]),
    })[0]!;
    expect(activity.summary).toBe("Subagent · 1");
    expect(activity.counters.toolCount).toBe(0);
    expect(activity.counters.subagents).toEqual([
      { description: "Summarize project files", background: false },
    ]);
  });

  it("summarizes a background subagent on the outer run activity row", () => {
    const activity = project([
      {
        kind: "tool",
        id: "subagent",
        runId: "run",
        turnId: "turn",
        createdSeq: 1,
        callId: "subagent",
        tool: "spawn_subagent",
        arguments: {
          description: "Scan agent-core sources",
          prompt: "Read core files under packages/agent-core.",
          run_in_background: true,
        },
        status: "completed",
      },
    ], "completed");
    expect(activity.summary).toBe("Subagent · 1");
  });

  it("summarizes multiple subagents with a compact count", () => {
    const activity = project([
      {
        kind: "tool",
        id: "subagent-a",
        runId: "run",
        turnId: "turn",
        createdSeq: 1,
        callId: "subagent-a",
        tool: "spawn_subagent",
        arguments: { description: "Task A", prompt: "Do A." },
        status: "completed",
      },
      {
        kind: "tool",
        id: "subagent-b",
        runId: "run",
        turnId: "turn",
        createdSeq: 2,
        callId: "subagent-b",
        tool: "spawn_subagent",
        arguments: {
          description: "Task B",
          prompt: "Do B.",
          run_in_background: true,
        },
        status: "completed",
      },
    ], "completed");
    expect(activity.summary).toBe("Subagent · 2");
  });

  it("counts glob and grep toward explored files in the summary", () => {
    const activity = projectRunActivities({
      items: [
        {
          kind: "tool",
          id: "glob",
          runId: "run",
          turnId: "turn",
          createdSeq: 1,
          callId: "glob",
          tool: "glob",
          arguments: { glob_pattern: "*.md", target_directory: "." },
          status: "completed",
        },
      ],
      runs: { run: { id: "run", status: "completed" } },
    })[0]!;
    expect(activity.summary).toBe("Explored 1 file");
    expect(activity.counters.exploredFiles).toEqual(["*.md"]);
  });

  it("does not create a fallback summary without presented tools", () => {
    const activity = project(
      [
        {
          kind: "assistant",
          id: "thought",
          runId: "run",
          turnId: "turn",
          createdSeq: 1,
          text: "",
          thinking: "considering",
          status: "completed",
          stopReason: "stop",
        },
      ],
      "completed",
    );
    expect(activity.summary).toBe("");
    expect(activity.hasActivity).toBe(true);
  });

  it("does not promote an undecided streaming message to final output", () => {
    const activity = project([
      {
        kind: "assistant",
        id: "streaming",
        runId: "run",
        turnId: "turn",
        createdSeq: 1,
        text: "I will inspect this first.",
        thinking: "",
        status: "streaming",
      },
    ]);
    expect(activity.finalAssistant).toBeUndefined();
    expect(activity.segments[0]?.content).toBe(
      "I will inspect this first.",
    );
  });

  it("projects Native, DSH and Claude command aliases identically", () => {
    const aliases = ["run_command", "pwsh", "Bash"];
    const projected = aliases.map((tool, index) =>
      project([
        {
          kind: "tool",
          id: `tool-${index}`,
          runId: "run",
          turnId: "turn",
          createdSeq: 1,
          callId: `tool-${index}`,
          tool,
          arguments: { command: "pnpm test" },
          status: "running",
        },
      ]),
    );
    expect(
      projected.map(({ phase, counters, currentAction }) => ({
        phase,
        commandCount: counters.commandCount,
        verb: currentAction?.verb,
      })),
    ).toEqual([
      { phase: "verifying", commandCount: 1, verb: "Running" },
      { phase: "verifying", commandCount: 1, verb: "Running" },
      { phase: "verifying", commandCount: 1, verb: "Running" },
    ]);
  });

  it("merges thinking from every turn into one block", () => {
    const activity = project([
      {
        kind: "assistant",
        id: "thinking-1",
        runId: "run",
        turnId: "turn-1",
        createdSeq: 1,
        text: "",
        thinking: "Inspect the files.",
        status: "completed",
        stopReason: "toolUse",
      },
      {
        kind: "assistant",
        id: "thinking-2",
        runId: "run",
        turnId: "turn-2",
        createdSeq: 2,
        text: "",
        thinking: "Run the tests.",
        status: "completed",
        stopReason: "toolUse",
      },
    ]);
    expect(activity.thinking).toBe(
      "Inspect the files.\n\nRun the tests.",
    );
  });

  it("keeps concrete tool verbs inside expanded details", () => {
    const read = {
      kind: "tool" as const,
      id: "read",
      runId: "run",
      turnId: "turn",
      createdSeq: 1,
      callId: "read",
      tool: "read_file",
      arguments: { path: "README.md" },
      status: "running" as const,
    };
    expect(toolLabel(read)).toBe("Read");
    expect(toolAction(read)).toEqual({
      verb: "Reading",
      target: "README.md",
    });
  });
});
