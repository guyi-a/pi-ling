import { describe, expect, it } from "vitest";

import {
  baseNameOf,
  directoryKeyOf,
  joinWorkspacePath,
  openTargetAfterCreate,
  parentDirOf,
} from "./file-operations";

describe("parentDirOf", () => {
  it("returns the parent of a file at the root as empty", () => {
    expect(parentDirOf("a.txt")).toBe("");
  });

  it("returns a directory parent with a trailing slash", () => {
    expect(parentDirOf("src/main/a.ts")).toBe("src/main/");
  });

  it("handles a directory path (with trailing slash)", () => {
    expect(parentDirOf("src/main/")).toBe("src/");
  });

  it("handles a top-level directory", () => {
    expect(parentDirOf("src/")).toBe("");
  });
});

describe("baseNameOf", () => {
  it("reads a file name", () => {
    expect(baseNameOf("src/main/a.ts")).toBe("a.ts");
    expect(baseNameOf("a.txt")).toBe("a.txt");
  });

  it("reads a directory name regardless of trailing slash", () => {
    expect(baseNameOf("src/main")).toBe("main");
    expect(baseNameOf("src/main/")).toBe("main");
  });
});

describe("joinWorkspacePath", () => {
  it("joins at the root", () => {
    expect(joinWorkspacePath("", "a.txt", "file")).toBe("a.txt");
    expect(joinWorkspacePath("", "src", "dir")).toBe("src/");
  });

  it("joins inside a directory that already ends with a slash", () => {
    expect(joinWorkspacePath("src/", "a.txt", "file")).toBe("src/a.txt");
    expect(joinWorkspacePath("src/", "main", "dir")).toBe("src/main/");
  });

  it("tolerates a directory path missing its trailing slash", () => {
    expect(joinWorkspacePath("src", "a.txt", "file")).toBe("src/a.txt");
  });

  it("round-trips with parentDirOf", () => {
    const created = joinWorkspacePath("src/main/", "a.ts", "file");
    expect(parentDirOf(created)).toBe("src/main/");
    expect(baseNameOf(created)).toBe("a.ts");
  });
});

describe("directoryKeyOf", () => {
  it("namespaces the key by workspace root", () => {
    // 同一个相对路径在不同工作区下必须是不同的键，否则展开状态会串
    expect(directoryKeyOf("E:/ws-a", "src/")).not.toBe(
      directoryKeyOf("E:/ws-b", "src/"),
    );
    expect(directoryKeyOf("E:/ws", "src/")).toBe("E:/ws:src/");
  });
});

describe("openTargetAfterCreate", () => {
  it("opens a newly created file", () => {
    expect(openTargetAfterCreate("src/a.ts", "file")).toBe("src/a.ts");
  });

  it("does not try to open a directory", () => {
    expect(openTargetAfterCreate("src/", "dir")).toBeUndefined();
  });
});
