import type { ChangedFile } from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import type { TimelineItem } from "../timeline/reducer";
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
