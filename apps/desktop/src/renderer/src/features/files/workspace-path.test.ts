import { describe, expect, it } from "vitest";

import {
  baseNameOf,
  directoryKeyOf,
  joinWorkspacePath,
  openTargetAfterCreate,
  parentDirOf,
  remapExpandedKeys,
  remapPath,
  renameSelectionRange,
  renamedPathOf,
} from "./workspace-path";

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

describe("remapPath", () => {
  it("remaps an exact file hit", () => {
    expect(remapPath("a.ts", "a.ts", "b.ts")).toBe("b.ts");
  });

  it("remaps a directory that keeps its trailing slash", () => {
    expect(remapPath("src/", "src/", "lib/")).toBe("lib/");
  });

  it("remaps descendants of a renamed directory", () => {
    expect(remapPath("src/a.ts", "src/", "lib/")).toBe("lib/a.ts");
    expect(remapPath("src/deep/a.ts", "src/", "lib/")).toBe("lib/deep/a.ts");
    expect(remapPath("src/deep/", "src/", "lib/")).toBe("lib/deep/");
  });

  it("does not touch unrelated paths", () => {
    expect(remapPath("other.ts", "a.ts", "b.ts")).toBe("other.ts");
    expect(remapPath("lib/a.ts", "src/", "lib/")).toBe("lib/a.ts");
  });

  it("matches on directory boundaries, not raw prefixes", () => {
    // 这是最容易写错的地方：`ab.ts` 不能被 `a.ts` 的改名带跑偏
    expect(remapPath("ab.ts", "a.ts", "b.ts")).toBe("ab.ts");
    expect(remapPath("srcx/a.ts", "src/", "lib/")).toBe("srcx/a.ts");
    expect(remapPath("src2/", "src/", "lib/")).toBe("src2/");
  });

  it("passes through empty and root paths untouched", () => {
    expect(remapPath("", "a.ts", "b.ts")).toBe("");
    expect(remapPath("a.ts", "", "b.ts")).toBe("a.ts");
  });
});

describe("remapExpandedKeys", () => {
  const root = "E:/ws";

  it("remaps the renamed directory's own expanded key", () => {
    const next = remapExpandedKeys({ "E:/ws:src/": true }, root, "src/", "lib/");
    expect(next).toEqual({ "E:/ws:lib/": true });
  });

  it("remaps descendants so the tree does not collapse after a rename", () => {
    const next = remapExpandedKeys(
      { "E:/ws:src/": true, "E:/ws:src/deep/": true, "E:/ws:docs/": true },
      root,
      "src/",
      "lib/",
    );
    expect(next).toEqual({
      "E:/ws:lib/": true,
      "E:/ws:lib/deep/": true,
      "E:/ws:docs/": true,
    });
  });

  it("leaves keys from other workspaces alone", () => {
    const next = remapExpandedKeys(
      { "E:/other:src/": true, "E:/ws:src/": true },
      root,
      "src/",
      "lib/",
    );
    expect(next).toEqual({ "E:/other:src/": true, "E:/ws:lib/": true });
  });

  it("remaps a file rename without collapsing anything", () => {
    const next = remapExpandedKeys({ "E:/ws:src/": true }, root, "src/a.ts", "src/b.ts");
    expect(next).toEqual({ "E:/ws:src/": true });
  });
});

describe("renamedPathOf", () => {
  it("keeps a file in its own directory", () => {
    expect(renamedPathOf("src/deep/a.ts", "b.ts")).toEqual({
      newPath: "src/deep/b.ts",
      kind: "file",
    });
  });

  it("keeps a root-level file at the root", () => {
    expect(renamedPathOf("a.ts", "b.ts")).toEqual({
      newPath: "b.ts",
      kind: "file",
    });
  });

  it("puts a renamed top-level directory at the root, not inside itself", () => {
    // 踩过的坑：早期把目录路径自己当成父目录，算出了 `src/lib/` ——
    // 于是 remapPath 把 src/b.ts 错映射成 src/lib/b.ts。
    // 这个 bug 单测测 remapPath 本身发现不了，必须连调用方一起测。
    expect(renamedPathOf("src/", "lib")).toEqual({
      newPath: "lib/",
      kind: "dir",
    });
  });

  it("keeps a nested directory in its own parent", () => {
    expect(renamedPathOf("src/deep/", "shallow")).toEqual({
      newPath: "src/shallow/",
      kind: "dir",
    });
  });

  it("round-trips with remapPath for the directory case", () => {
    // 这是端到端的核心断言：目录改名后，其子文件必须落在新目录下
    const { newPath } = renamedPathOf("src/", "lib");
    expect(remapPath("src/b.ts", "src/", newPath)).toBe("lib/b.ts");
    expect(remapPath("src/", "src/", newPath)).toBe("lib/");
    expect(remapPath("src/deep/a.ts", "src/", newPath)).toBe("lib/deep/a.ts");
    // 无关路径不受影响
    expect(remapPath("docs/x.md", "src/", newPath)).toBe("docs/x.md");
  });

  it("round-trips with remapExpandedKeys for the directory case", () => {
    const { newPath } = renamedPathOf("src/", "lib");
    const next = remapExpandedKeys(
      { "E:/ws:src/": true, "E:/ws:src/deep/": true },
      "E:/ws",
      "src/",
      newPath,
    );
    expect(next).toEqual({ "E:/ws:lib/": true, "E:/ws:lib/deep/": true });
  });
});

describe("renameSelectionRange", () => {  it("selects a file's base name, leaving the extension", () => {
    // 对齐 VS Code / Cursor：改 a.ts -> b.ts 时不用重打扩展名
    expect(renameSelectionRange("a.ts", "file")).toEqual([0, 1]);
    expect(renameSelectionRange("index.html", "file")).toEqual([0, 5]);
    expect(renameSelectionRange("a.tar.gz", "file")).toEqual([0, 5]);
  });

  it("selects the whole name when there is no extension", () => {
    expect(renameSelectionRange("README", "file")).toEqual([0, 6]);
  });

  it("selects dotfiles entirely", () => {
    // 前导点是隐藏文件标记，不是扩展名
    expect(renameSelectionRange(".env", "file")).toEqual([0, 4]);
    expect(renameSelectionRange(".gitignore", "file")).toEqual([0, 10]);
  });

  it("selects a directory's name entirely", () => {
    expect(renameSelectionRange("my.folder", "dir")).toEqual([0, 9]);
  });
});
