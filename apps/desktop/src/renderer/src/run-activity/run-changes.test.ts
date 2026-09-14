import type { ChangedFile } from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import type { ChangesTimelineItem, TimelineItem } from "../timeline/reducer";
import {
  changesFilesByRunId,
  lastAgentTurnChanges,
  reconcileLastAgentTurnChanges,
} from "./run-changes";

function changesItem(
  runId: string,
  createdSeq: number,
  files: ChangedFile[],
): TimelineItem {
  return {
    kind: "changes",
    id: `changes:${createdSeq}`,
    runId,
    createdSeq,
    turnId: `run:${runId}:turn:1`,
    callId: `call:${createdSeq}`,
    files,
  };
}

describe("reverted files (create then delete)", () => {
  const added = (path: string): ChangedFile => ({
    path,
    status: "added",
    binary: false,
    sensitive: false,
    tooLarge: false,
    additions: 3,
  });

  /**
   * 关键背景：`changes` 事件携带的是 `ChangeTracker.changedFiles()` —— 一个
   * **会话级累计快照**（每次文件改动后重算全量），不是一个工具的增量。
   *
   * 所以「创建两个测试文件 → 跑测试 → 删掉」之后，净改动为空；但过去因为
   * `if (files.length === 0) return` 不会补发事件，最后一个快照仍停在被删之前。
   * 渲染层若用并集（byPath.set），这两个文件会永远留在列表里。
   */
  it("drops files that a later snapshot no longer reports", () => {
    const items: TimelineItem[] = [
      changesItem("run-1", 1, [added("a.test.ts"), added("b.test.ts")]),
      // 删除之后：净改动为空（现在会补发这个空快照）
      changesItem("run-1", 2, []),
    ];
    expect(changesFilesByRunId(items, "run-1")).toEqual([]);
    expect(lastAgentTurnChanges(items, {})).toEqual([]);
  });

  it("uses the latest cumulative snapshot instead of a union of all of them", () => {
    // 快照是累计的，所以「最后一个」就是权威值；
    // 早期快照里 later-snapshot 不再包含的文件必须被丢掉
    const items: TimelineItem[] = [
      changesItem("run-1", 1, [added("gone.ts"), added("kept.ts")]),
      changesItem("run-1", 2, [added("kept.ts")]),
    ];
    expect(changesFilesByRunId(items, "run-1").map((f) => f.path)).toEqual([
      "kept.ts",
    ]);
    expect(lastAgentTurnChanges(items, {}).map((f) => f.path)).toEqual([
      "kept.ts",
    ]);
  });

  it("still grows cumulatively when later snapshots add files", () => {
    const items: TimelineItem[] = [
      changesItem("run-1", 1, [added("a.ts")]),
      changesItem("run-1", 2, [added("a.ts"), added("b.ts")]),
    ];
    expect(changesFilesByRunId(items, "run-1").map((f) => f.path)).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  it("respects editToolsOnly when choosing the latest snapshot", () => {
    const items: TimelineItem[] = [
      {
        kind: "tool",
        id: "t-edit",
        runId: "run-1",
        turnId: "run:run-1:turn:1",
        createdSeq: 1,
        callId: "edit-1",
        tool: "write_file",
        arguments: { path: "a.ts" },
        status: "completed",
      },
      changesItem("run-1", 2, [added("a.ts"), added("b.ts")]),
    ];
    // 让这个 changes 事件归属 edit 工具
    items[1] = { ...(items[1] as ChangesTimelineItem), callId: "edit-1" };
    const editToolsOnly = changesFilesByRunId(items, "run-1", {
      editToolsOnly: true,
    });
    expect(editToolsOnly.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("lastAgentTurnChanges", () => {
  it("aggregates the latest run's changes and dedups by path", () => {
    const items: TimelineItem[] = [
      changesItem("run-1", 1, [
        { path: "a.ts", status: "modified", binary: false, sensitive: false, tooLarge: false, additions: 1, deletions: 1 },
      ]),
      changesItem("run-2", 5, [
        { path: "a.ts", status: "modified", binary: false, sensitive: false, tooLarge: false, additions: 2, deletions: 1 },
        { path: "b.ts", status: "added", binary: false, sensitive: false, tooLarge: false, additions: 3 },
      ]),
    ];
    const result = lastAgentTurnChanges(items, {});
    expect(result).toHaveLength(2);
    expect(result.map((file) => file.path).sort()).toEqual(["a.ts", "b.ts"]);
    const a = result.find((file) => file.path === "a.ts")!;
    expect(a.additions).toBe(2);
  });

  it("returns empty when there are no changes items", () => {
    expect(lastAgentTurnChanges([], {})).toEqual([]);
  });
});

describe("reconcileLastAgentTurnChanges", () => {
  it("drops timeline files that no longer have net workspace changes", () => {
    const turnFiles: ChangedFile[] = [
      {
        path: "py/a.py",
        status: "added",
        binary: false,
        sensitive: false,
        tooLarge: false,
        additions: 52,
      },
      {
        path: "py/b.py",
        status: "added",
        binary: false,
        sensitive: false,
        tooLarge: false,
        additions: 9,
      },
    ];
    expect(reconcileLastAgentTurnChanges(turnFiles, [])).toEqual([]);
  });

  it("uses net file metadata for paths still changed on disk", () => {
    const turnFiles: ChangedFile[] = [
      {
        path: "src/a.ts",
        status: "added",
        binary: false,
        sensitive: false,
        tooLarge: false,
        additions: 99,
      },
    ];
    const netFiles: ChangedFile[] = [
      {
        path: "src/a.ts",
        status: "modified",
        binary: false,
        sensitive: false,
        tooLarge: false,
        additions: 3,
        deletions: 1,
      },
    ];
    expect(reconcileLastAgentTurnChanges(turnFiles, netFiles)).toEqual(netFiles);
  });
});

describe("changesFilesByRunId", () => {
  it("returns files for a specific run", () => {
    const items: TimelineItem[] = [
      changesItem("run-1", 1, [
        { path: "a.ts", status: "modified", binary: false, sensitive: false, tooLarge: false },
      ]),
      changesItem("run-2", 5, [
        { path: "b.ts", status: "added", binary: false, sensitive: false, tooLarge: false, additions: 2 },
      ]),
    ];
    expect(changesFilesByRunId(items, "run-2")).toEqual([
      {
        path: "b.ts",
        status: "added",
        binary: false,
        sensitive: false,
        tooLarge: false,
        additions: 2,
      },
    ]);
  });

  it("filters out changes from read-only tools when editToolsOnly is set", () => {
    const items: TimelineItem[] = [
      {
        kind: "tool",
        id: "tool:glob",
        runId: "run-2",
        turnId: "turn",
        createdSeq: 1,
        callId: "glob-call",
        tool: "glob",
        arguments: { glob_pattern: "*.md" },
        status: "completed",
      },
      {
        kind: "changes",
        id: "changes:2",
        runId: "run-2",
        createdSeq: 2,
        turnId: "turn",
        callId: "glob-call",
        files: [
          {
            path: "a.md",
            status: "added",
            binary: false,
            sensitive: false,
            tooLarge: false,
            additions: 1,
          },
        ],
      },
    ];
    expect(changesFilesByRunId(items, "run-2")).toHaveLength(1);
    expect(changesFilesByRunId(items, "run-2", { editToolsOnly: true })).toEqual(
      [],
    );
  });
});
