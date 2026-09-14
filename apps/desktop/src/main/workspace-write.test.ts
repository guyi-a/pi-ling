import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  readTextForDiff,
  resolveWorkspacePath,
  writeFileContent,
} from "./workspace-fs.js";

describe("writeFileContent", () => {
  let root = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-write-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("writes a text file inside an existing directory", async () => {
    await fs.mkdir(path.join(root, "notes"));
    const result = await writeFileContent(root, "notes/todo.md", "hello");
    expect(result).toEqual({ ok: true, size: 5 });
    expect(await fs.readFile(path.join(root, "notes", "todo.md"), "utf8")).toBe(
      "hello",
    );
  });

  it("overwrites an existing file", async () => {
    await fs.writeFile(path.join(root, "a.txt"), "old");
    const result = await writeFileContent(root, "a.txt", "new content");
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(root, "a.txt"), "utf8")).toBe(
      "new content",
    );
  });

  it("counts UTF-8 bytes rather than characters", async () => {
    const result = await writeFileContent(root, "cn.txt", "中文");
    expect(result).toEqual({ ok: true, size: 6 });
  });

  it("rejects paths escaping the workspace", async () => {
    const result = await writeFileContent(root, "../outside.txt", "x");
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("escapes"),
    });
    await expect(
      fs.stat(path.join(root, "..", "outside.txt")),
    ).rejects.toBeDefined();
  });

  it("tolerates an absolute path inside the workspace, as read does", async () => {
    // 与 readFileContent 的既有行为保持一致：root 内的绝对路径放行，
    // 因为仍然落在工作区内，不构成越界。
    const result = await writeFileContent(root, path.join(root, "abs.txt"), "x");
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(root, "abs.txt"), "utf8")).toBe("x");
  });

  it("rejects an absolute path outside the workspace", async () => {
    const result = await writeFileContent(
      root,
      path.join(root, "..", "outside-abs.txt"),
      "x",
    );
    expect(result.ok).toBe(false);
  });

  it("rejects writing to a directory", async () => {
    await fs.mkdir(path.join(root, "dir"));
    const result = await writeFileContent(root, "dir", "x");
    expect(result).toEqual({ ok: false, message: expect.stringContaining("目录") });
  });

  it("rejects creating a file whose parent directory is missing", async () => {
    const result = await writeFileContent(root, "missing/deep/a.txt", "x");
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("父目录"),
    });
  });

  it("rejects content above the size cap", async () => {
    const result = await writeFileContent(root, "big.txt", "x".repeat(4 * 1024 * 1024 + 1));
    expect(result.ok).toBe(false);
  });
});

describe("readTextForDiff", () => {
  let root = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-difftext-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads text content", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "export {}");
    expect(await readTextForDiff(root, "a.ts")).toBe("export {}");
  });

  it("returns undefined for a missing file", async () => {
    expect(await readTextForDiff(root, "nope.ts")).toBeUndefined();
  });

  it("returns undefined for binary content", async () => {
    await fs.writeFile(path.join(root, "b.bin"), Buffer.from([0, 1, 2, 3]));
    expect(await readTextForDiff(root, "b.bin")).toBeUndefined();
  });

  it("returns undefined for paths outside the workspace", async () => {
    expect(await readTextForDiff(root, "../escape.txt")).toBeUndefined();
  });
});

describe("resolveWorkspacePath", () => {
  it("allows nested paths inside the root", () => {
    const root = path.resolve("E:/ws");
    expect(resolveWorkspacePath(root, "a/b.txt")).toBe(
      path.join(root, "a", "b.txt"),
    );
  });

  it("rejects traversal", () => {
    const root = path.resolve("E:/ws");
    expect(() => resolveWorkspacePath(root, "../x.txt")).toThrow();
  });
});

describe("createWorkspaceEntry", () => {
  let root = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-create-"));
    await fs.mkdir(path.join(root, "src"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("creates a file at the workspace root", async () => {
    const result = await createWorkspaceEntry(root, "", "new.txt", "file");
    expect(result).toEqual({ ok: true });
    expect(await fs.readFile(path.join(root, "new.txt"), "utf8")).toBe("");
  });

  it("creates a directory", async () => {
    const result = await createWorkspaceEntry(root, "", "assets", "dir");
    expect(result).toEqual({ ok: true });
    expect((await fs.stat(path.join(root, "assets"))).isDirectory()).toBe(true);
  });

  it("creates inside a nested directory, with or without a trailing slash", async () => {
    expect(
      await createWorkspaceEntry(root, "src", "a.ts", "file"),
    ).toEqual({ ok: true });
    expect(
      await createWorkspaceEntry(root, "src/", "b.ts", "file"),
    ).toEqual({ ok: true });
    expect(
      await fs.readFile(path.join(root, "src", "a.ts"), "utf8"),
    ).toBe("");
    expect(
      await fs.readFile(path.join(root, "src", "b.ts"), "utf8"),
    ).toBe("");
  });

  it("refuses to overwrite an existing file", async () => {
    await fs.writeFile(path.join(root, "keep.txt"), "do not lose me");
    const result = await createWorkspaceEntry(root, "", "keep.txt", "file");
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("已存在同名文件"),
    });
    // 关键：内容必须原封不动
    expect(await fs.readFile(path.join(root, "keep.txt"), "utf8")).toBe(
      "do not lose me",
    );
  });

  it("refuses a duplicate directory", async () => {
    const result = await createWorkspaceEntry(root, "", "src", "dir");
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("已存在同名目录"),
    });
  });

  it("reports a missing parent directory", async () => {
    const result = await createWorkspaceEntry(root, "nope", "a.txt", "file");
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining("父目录不存在"),
    });
  });

  it("rejects a parent path that escapes the workspace", async () => {
    const result = await createWorkspaceEntry(root, "../..", "a.txt", "file");
    expect(result.ok).toBe(false);
  });

  it("rejects names containing a path separator", async () => {
    for (const name of ["a/b.txt", "a\\b.txt"]) {
      const result = await createWorkspaceEntry(root, "", name, "file");
      expect(result, name).toEqual({
        ok: false,
        message: expect.stringContaining("路径分隔符"),
      });
    }
  });

  it("rejects empty, relative and reserved names", async () => {
    for (const name of ["", "   ", ".", "..", "nul", "COM1", "a."]) {
      const result = await createWorkspaceEntry(root, "", name, "file");
      expect(result.ok, JSON.stringify(name)).toBe(false);
    }
  });

  it("trims surrounding whitespace rather than rejecting it", async () => {
    // 尾部空格交给 trim 处理（Windows 自身也会去掉），不必当成非法名
    for (const [input, expected] of [
      ["  spaced.txt  ", "spaced.txt"],
      ["trailing.txt ", "trailing.txt"],
    ] as const) {
      const result = await createWorkspaceEntry(root, "", input, "file");
      expect(result, input).toEqual({ ok: true });
      expect((await fs.stat(path.join(root, expected))).isFile(), input).toBe(
        true,
      );
    }
  });

  it("rejects illegal characters", async () => {
    for (const name of ["a:b.txt", "a*b.txt", 'a"b.txt', "a<b.txt"]) {
      const result = await createWorkspaceEntry(root, "", name, "file");
      expect(result.ok, name).toBe(false);
    }
  });

  it("trims surrounding whitespace rather than rejecting it", async () => {
    // 尾部空格交给 trim 处理（Windows 自身也会去掉），不必当成非法名
    for (const [input, expected] of [
      ["  spaced.txt  ", "spaced.txt"],
      ["trailing.txt ", "trailing.txt"],
    ] as const) {
      const result = await createWorkspaceEntry(root, "", input, "file");
      expect(result, input).toEqual({ ok: true });
      expect((await fs.stat(path.join(root, expected))).isFile(), input).toBe(
        true,
      );
    }
  });
});

describe("deleteWorkspaceEntry", () => {
  let root = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-delete-"));
    await fs.mkdir(path.join(root, "src", "deep"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "deep", "a.ts"), "x");
    await fs.mkdir(path.join(root, ".git"));
    await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main");
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("deletes a file", async () => {
    const result = await deleteWorkspaceEntry(root, "src/deep/a.ts");
    expect(result).toEqual({ ok: true });
    await expect(fs.stat(path.join(root, "src", "deep", "a.ts"))).rejects.toBeDefined();
  });

  it("deletes a directory recursively", async () => {
    const result = await deleteWorkspaceEntry(root, "src");
    expect(result).toEqual({ ok: true });
    await expect(fs.stat(path.join(root, "src"))).rejects.toBeDefined();
  });

  it("accepts a trailing slash on a directory path", async () => {
    expect(await deleteWorkspaceEntry(root, "src/")).toEqual({ ok: true });
  });

  it("refuses to delete the workspace root", async () => {
    expect(await deleteWorkspaceEntry(root, "")).toEqual({
      ok: false,
      message: expect.stringContaining("根目录"),
    });
    expect(await deleteWorkspaceEntry(root, ".")).toEqual({
      ok: false,
      message: expect.stringContaining("根目录"),
    });
    // 工作区必须还在
    expect((await fs.stat(root)).isDirectory()).toBe(true);
  });

  it("refuses to delete .git at the top level", async () => {
    expect(await deleteWorkspaceEntry(root, ".git")).toEqual({
      ok: false,
      message: expect.stringContaining(".git"),
    });
    expect(await deleteWorkspaceEntry(root, ".git/HEAD")).toEqual({
      ok: false,
      message: expect.stringContaining(".git"),
    });
    // 必须真的没删掉
    expect((await fs.stat(path.join(root, ".git", "HEAD"))).isFile()).toBe(true);
  });

  it("rejects paths escaping the workspace", async () => {
    const result = await deleteWorkspaceEntry(root, "../outside");
    expect(result.ok).toBe(false);
  });

  it("reports a missing target instead of throwing", async () => {
    const result = await deleteWorkspaceEntry(root, "not-there.txt");
    // rm 带 force，缺失视为成功；关键是不要抛异常
    expect(result).toEqual({ ok: true });
  });
});
