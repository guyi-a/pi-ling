import { describe, expect, it } from "vitest";

import {
  collapseContext,
  COLLAPSE_THRESHOLD,
  diffStats,
  parseUnifiedDiff,
} from "./UnifiedDiffView";

const SAMPLE_PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,5 +1,6 @@",
  " const a = 1",
  "-const b = 2",
  "+const b = 3",
  "+const c = 4",
  " const d = 5",
  " const e = 6",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("parses add/delete/context lines with line numbers", () => {
    const lines = parseUnifiedDiff(SAMPLE_PATCH);
    expect(lines[0]).toEqual({ kind: "hunk", text: "@@ -1,5 +1,6 @@" });
    expect(lines[1]).toEqual({ kind: "context", text: "const a = 1", oldLine: 1, newLine: 1 });
    expect(lines[2]).toEqual({ kind: "delete", text: "const b = 2", oldLine: 2 });
    expect(lines[3]).toEqual({ kind: "add", text: "const b = 3", newLine: 2 });
    expect(lines[4]).toEqual({ kind: "add", text: "const c = 4", newLine: 3 });
  });

  it("skips diff meta headers", () => {
    const lines = parseUnifiedDiff(SAMPLE_PATCH);
    const kinds = lines.map((line) => line.kind);
    expect(kinds).not.toContain("meta");
  });

  it("keeps unknown lines as meta", () => {
    const lines = parseUnifiedDiff("\\ No newline at end of file\ncontext");
    expect(lines.some((line) => line.kind === "meta")).toBe(true);
  });
});

describe("diffStats", () => {
  it("counts additions and deletions", () => {
    expect(diffStats(SAMPLE_PATCH)).toEqual({ additions: 2, deletions: 1 });
  });
});

describe("collapseContext", () => {
  it("collapses runs larger than threshold", () => {
    const contextLines = Array.from(
      { length: COLLAPSE_THRESHOLD + 5 },
      (_, index) => ({
        kind: "context" as const,
        text: `line ${index}`,
        oldLine: index,
        newLine: index,
      }),
    );
    const lines = [...contextLines, { kind: "add" as const, text: "added", newLine: 99 }];
    const collapsed = collapseContext(lines, COLLAPSE_THRESHOLD);
    expect(collapsed[0]).toEqual({ kind: "collapsed", count: COLLAPSE_THRESHOLD + 5 });
  });

  it("keeps small context runs", () => {
    const contextLines = Array.from({ length: 3 }, (_, index) => ({
      kind: "context" as const,
      text: `line ${index}`,
      oldLine: index,
      newLine: index,
    }));
    const lines = [...contextLines, { kind: "add" as const, text: "added", newLine: 99 }];
    const collapsed = collapseContext(lines, COLLAPSE_THRESHOLD);
    expect(collapsed).toHaveLength(4);
    expect(collapsed[0]).toHaveProperty("kind", "context");
  });
});
