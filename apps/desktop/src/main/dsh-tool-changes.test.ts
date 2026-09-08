import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeWorkspaceRelativePath,
  resolveToolWorkspacePath,
} from "./dsh-tool-changes.js";

describe("normalizeWorkspaceRelativePath", () => {
  const root = path.resolve("E:/pi-ling");

  it("keeps relative paths", () => {
    expect(normalizeWorkspaceRelativePath("b.md", root)).toBe("b.md");
    expect(normalizeWorkspaceRelativePath("src/a.ts", root)).toBe("src/a.ts");
  });

  it("converts absolute paths inside workspace", () => {
    expect(
      normalizeWorkspaceRelativePath(path.join(root, "b.md"), root),
    ).toBe("b.md");
  });

  it("rejects paths outside workspace", () => {
    expect(
      normalizeWorkspaceRelativePath("E:/other/file.txt", root),
    ).toBeUndefined();
  });
});

describe("resolveToolWorkspacePath", () => {
  it("reads file_path from tool input", () => {
    const root = path.resolve("E:/pi-ling");
    expect(
      resolveToolWorkspacePath(
        { file_path: path.join(root, "b.md") },
        root,
      ),
    ).toBe("b.md");
  });
});
