import type { ChangedFile } from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import {
  buildGitDecorations,
  decorationForFile,
  GIT_DECORATION_LETTER,
} from "./git-decorations";

function file(
  path: string,
  status: ChangedFile["status"],
  staged = false,
): ChangedFile {
  return {
    path,
    status,
    binary: false,
    sensitive: false,
    tooLarge: false,
    staged,
  };
}

describe("decorationForFile", () => {
  it("distinguishes staged additions from untracked files", () => {
    expect(decorationForFile(file("a.ts", "added", true))).toBe("added");
    expect(decorationForFile(file("b.ts", "added", false))).toBe("untracked");
  });

  it("maps modified and deleted", () => {
    expect(decorationForFile(file("a.ts", "modified"))).toBe("modified");
    expect(decorationForFile(file("a.ts", "deleted"))).toBe("deleted");
  });
});

describe("buildGitDecorations", () => {
  it("decorates files and every ancestor directory", () => {
    const result = buildGitDecorations([file("apps/desktop/src/main.ts", "modified")]);
    expect(result.files.get("apps/desktop/src/main.ts")).toBe("modified");
    expect(result.dirs.get("apps/")).toBe("modified");
    expect(result.dirs.get("apps/desktop/")).toBe("modified");
    expect(result.dirs.get("apps/desktop/src/")).toBe("modified");
  });

  it("aggregates directory state by priority: deleted > modified > added", () => {
    const result = buildGitDecorations([
      file("src/a.ts", "added", false),
      file("src/b.ts", "modified"),
    ]);
    expect(result.dirs.get("src/")).toBe("modified");

    const withDeleted = buildGitDecorations([
      file("src/a.ts", "modified"),
      file("src/b.ts", "deleted"),
    ]);
    expect(withDeleted.dirs.get("src/")).toBe("deleted");
  });

  it("returns empty maps for a clean workspace", () => {
    const result = buildGitDecorations([]);
    expect(result.files.size).toBe(0);
    expect(result.dirs.size).toBe(0);
  });

  it("derives a single-letter badge for each state", () => {
    expect(GIT_DECORATION_LETTER.untracked).toBe("U");
    expect(GIT_DECORATION_LETTER.added).toBe("A");
    expect(GIT_DECORATION_LETTER.modified).toBe("M");
    expect(GIT_DECORATION_LETTER.deleted).toBe("D");
  });
});
