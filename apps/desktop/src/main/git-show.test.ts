import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { gitShowFile, gitShowIndexFile } from "./git-diff.js";

/** 建一个临时 git 仓库，便于验证 show 相关读取。 */
async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-gitshow-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  return root;
}

describe("gitShowFile / gitShowIndexFile", () => {
  let root = "";

  beforeEach(async () => {
    root = await makeRepo();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "pipe" });

  it("reads committed content at HEAD", async () => {
    await fs.writeFile(path.join(root, "a.txt"), "committed\n");
    git(root, "add", "a.txt");
    git(root, "commit", "-q", "-m", "init");

    expect(await gitShowFile(root, "HEAD", "a.txt")).toBe("committed\n");
  });

  it("returns undefined for a file absent at that revision", async () => {
    await fs.writeFile(path.join(root, "a.txt"), "committed\n");
    git(root, "add", "a.txt");
    git(root, "commit", "-q", "-m", "init");

    // 新增文件：HEAD 里还没有它
    await fs.writeFile(path.join(root, "new.txt"), "brand new\n");
    expect(await gitShowFile(root, "HEAD", "new.txt")).toBeUndefined();
  });

  it("reads index content, which differs from HEAD after staging", async () => {
    await fs.writeFile(path.join(root, "a.txt"), "v1\n");
    git(root, "add", "a.txt");
    git(root, "commit", "-q", "-m", "init");

    await fs.writeFile(path.join(root, "a.txt"), "v2\n");
    git(root, "add", "a.txt");

    expect(await gitShowFile(root, "HEAD", "a.txt")).toBe("v1\n");
    expect(await gitShowIndexFile(root, "a.txt")).toBe("v2\n");
  });

  it("returns undefined when the file is not in the index", async () => {
    expect(await gitShowIndexFile(root, "missing.txt")).toBeUndefined();
  });

  it("returns undefined outside a git repository", async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-nogit-"));
    try {
      await fs.writeFile(path.join(plain, "a.txt"), "x");
      expect(await gitShowFile(plain, "HEAD", "a.txt")).toBeUndefined();
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });
});
