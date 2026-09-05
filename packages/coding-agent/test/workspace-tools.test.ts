import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ChangeTracker,
  CommandRunner,
  Workspace,
} from "../src/index.js";

describe("Workspace and tools", () => {
  let root = "";
  let workspace: Workspace;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-workspace-"));
    workspace = await Workspace.open(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects traversal and absolute paths", async () => {
    await expect(workspace.resolve("../outside.txt")).rejects.toThrow(
      "outside the workspace",
    );
    await expect(workspace.resolve(path.resolve(root, "file.txt"))).rejects.toThrow(
      "Absolute paths",
    );
  });

  it("rejects paths that escape through a directory symlink", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-outside-"));
    try {
      await fs.symlink(outside, path.join(root, "linked"), "junction");
      await expect(workspace.resolve("linked/file.txt")).rejects.toThrow(
        "resolves outside",
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("bounds recursive listing and ignores dependency trees", async () => {
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "src", "index.ts"), "hello");
    await fs.mkdir(path.join(root, "node_modules"));
    await fs.writeFile(path.join(root, "node_modules", "hidden.js"), "hidden");

    const entries = await workspace.list(".", true);
    expect(entries.map((entry) => entry.path)).toContain("src/index.ts");
    expect(entries.map((entry) => entry.path)).not.toContain(
      "node_modules/hidden.js",
    );
  });

  it("captures a baseline and creates a safe diff", async () => {
    await fs.writeFile(path.join(root, "hello.txt"), "before\n");
    const changes = new ChangeTracker(workspace);
    await changes.capture("hello.txt");
    await workspace.writeText("hello.txt", "after\n");

    expect(await changes.changedFiles()).toEqual([
      expect.objectContaining({ path: "hello.txt", status: "modified" }),
    ]);
    expect((await changes.diff("hello.txt"))?.patch).toContain("-before");
    expect((await changes.diff("hello.txt"))?.patch).toContain("+after");
  });

  it("does not expose sensitive file contents in diffs", async () => {
    await fs.writeFile(path.join(root, ".env"), "TOKEN=before\n");
    const changes = new ChangeTracker(workspace);
    await changes.capture(".env");
    await workspace.writeText(".env", "TOKEN=after\n");
    expect(await changes.diff(".env")).toBeUndefined();
  });

  it("runs commands with bounded output and supports cancellation", async () => {
    const runner = new CommandRunner(root, 5000, 16);
    const completed = await runner.run(
      'node -e "console.log(`abcdefghijklmnopqrstuvwxyz`)"',
      new AbortController().signal,
    );
    expect(completed.truncated).toBe(true);

    const controller = new AbortController();
    const running = runner.run(
      'node -e "setTimeout(() => {}, 10000)"',
      controller.signal,
    );
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });

    const timeoutRunner = new CommandRunner(root, 20, 1024);
    const timedOut = await timeoutRunner.run(
      'node -e "setTimeout(() => {}, 10000)"',
      new AbortController().signal,
    );
    expect(timedOut.timedOut).toBe(true);
  });
});
