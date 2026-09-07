import type { ChangedFile } from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import { sumChanges } from "./changes-source";

describe("sumChanges", () => {
  it("sums additions and deletions across files", () => {
    const files: ChangedFile[] = [
      { path: "a.ts", status: "modified", binary: false, sensitive: false, tooLarge: false, additions: 5, deletions: 2 },
      { path: "b.ts", status: "added", binary: false, sensitive: false, tooLarge: false, additions: 7 },
      { path: "c.ts", status: "deleted", binary: false, sensitive: false, tooLarge: false, deletions: 9 },
    ];
    expect(sumChanges(files)).toEqual({ additions: 12, deletions: 11 });
  });

  it("returns zeros when no files or missing stats", () => {
    expect(sumChanges([])).toEqual({ additions: 0, deletions: 0 });
    expect(
      sumChanges([
        { path: "x.ts", status: "modified", binary: false, sensitive: false, tooLarge: false },
      ]),
    ).toEqual({ additions: 0, deletions: 0 });
  });
});
