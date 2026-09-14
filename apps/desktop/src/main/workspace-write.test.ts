import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
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
