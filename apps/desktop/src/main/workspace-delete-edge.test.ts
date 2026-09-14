import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deleteWorkspaceEntry } from "./workspace-fs.js";

/**
 * 探查真实文件系统的删除行为边界。
 *
 * `rm(recursive, force)` 在 Windows 上并非万能：`force` 只忽略 ENOENT，
 * 不会摘掉只读属性、也解不开被占用的句柄。这些用例是用来**定位**问题的，
 * 先看清哪些场景真的会失败，再决定要不要特殊处理。
 */
describe("deleteWorkspaceEntry on tricky Windows cases", () => {
  let root = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-rm-edge-"));
  });

  afterEach(async () => {
    // 先摘掉只读属性，否则清理会失败并留下垃圾目录
    await fs
      .chmod(path.join(root), 0o777)
      .catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true }).catch(async () => {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
    });
  });

  it("deletes a plain file", async () => {
    await fs.writeFile(path.join(root, "plain.txt"), "x");
    expect(await deleteWorkspaceEntry(root, "plain.txt")).toEqual({ ok: true });
  });

  it("deletes a read-only file", async () => {
    const target = path.join(root, "readonly.txt");
    await fs.writeFile(target, "x");
    await fs.chmod(target, 0o444);
    const result = await deleteWorkspaceEntry(root, "readonly.txt");
    // 记录真实行为：若这里失败，说明只读文件删不掉
    expect(result, `read-only file: ${JSON.stringify(result)}`).toEqual({
      ok: true,
    });
  });

  it("deletes a directory containing a read-only file", async () => {
    const dir = path.join(root, "pkg");
    await fs.mkdir(dir);
    const inner = path.join(dir, "locked.txt");
    await fs.writeFile(inner, "x");
    await fs.chmod(inner, 0o444);
    const result = await deleteWorkspaceEntry(root, "pkg");
    expect(result, `dir with read-only file: ${JSON.stringify(result)}`).toEqual(
      { ok: true },
    );
  });

  it("deletes a git repository directory (many read-only objects)", async () => {
    const repo = path.join(root, "repo");
    await fs.mkdir(repo);
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
    await fs.writeFile(path.join(repo, "a.txt"), "x");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

    const result = await deleteWorkspaceEntry(root, "repo");
    expect(result, `git repo dir: ${JSON.stringify(result)}`).toEqual({
      ok: true,
    });
  });

  it("deletes a directory containing many nested subdirectories", async () => {
    const base = path.join(root, "deep");
    let current = base;
    for (let i = 0; i < 6; i += 1) {
      current = path.join(current, `level-${i}`);
      await fs.mkdir(current, { recursive: true });
      await fs.writeFile(path.join(current, "f.txt"), String(i));
    }
    const result = await deleteWorkspaceEntry(root, "deep");
    expect(result, `deep tree: ${JSON.stringify(result)}`).toEqual({ ok: true });
  });

  it("returns a message (not a throw) when the parent is read-only", async () => {
    const dir = path.join(root, "ro-dir");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "inner.txt"), "x");
    await fs.chmod(dir, 0o555);
    const result = await deleteWorkspaceEntry(root, "ro-dir/inner.txt");
    // 只读目录里的文件删不掉时，必须给出 message 而不是抛异常
    if (!result.ok) {
      expect(result.message).toBeTruthy();
    }
    await fs.chmod(dir, 0o777);
  });
});
