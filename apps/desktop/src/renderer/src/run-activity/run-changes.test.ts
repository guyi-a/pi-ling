import type { ChangedFile } from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import type { TimelineItem } from "../timeline/reducer";
import { lastAgentTurnChanges } from "./run-changes";

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
