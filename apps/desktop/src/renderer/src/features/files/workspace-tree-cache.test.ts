import { describe, expect, it } from "vitest";

import {
  readWorkspaceTreeCache,
  readWorkspaceTreeCacheLatest,
  writeWorkspaceTreeCache,
} from "./workspace-tree-cache";

describe("workspace tree cache", () => {
  it("falls back to the latest cached snapshot while refreshing", () => {
    const root = "/tmp/test-workspace";
    writeWorkspaceTreeCache(root, 1, {
      entries: [{ name: "a.ts", path: "a.ts", kind: "file" }],
      rootName: "test-workspace",
      truncated: false,
    });
    expect(readWorkspaceTreeCache(root, 2)).toBeUndefined();
    expect(readWorkspaceTreeCacheLatest(root, 2)?.entries[0]?.name).toBe(
      "a.ts",
    );
  });
});
