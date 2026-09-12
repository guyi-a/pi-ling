import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  importFilesToWorkspaceRoot,
  MAX_WORKSPACE_UPLOAD_BYTES,
} from "./workspace-upload.js";

describe("workspace-upload", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  async function tempWorkspace(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-ling-upload-"));
    roots.push(root);
    return root;
  }

  it("copies files into the workspace root", async () => {
    const workspaceRoot = await tempWorkspace();
    const sourceDir = await mkdtemp(path.join(os.tmpdir(), "pi-ling-upload-src-"));
    roots.push(sourceDir);
    const source = path.join(sourceDir, "notes.txt");
    await writeFile(source, "hello upload\n");

    const saved = await importFilesToWorkspaceRoot({
      workspaceRoot,
      sourcePaths: [source],
    });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.relativePath).toBe("notes.txt");
    expect(await readFile(path.join(workspaceRoot, "notes.txt"), "utf8")).toBe(
      "hello upload\n",
    );
  });

  it("renames on filename conflict", async () => {
    const workspaceRoot = await tempWorkspace();
    await writeFile(path.join(workspaceRoot, "report.pdf"), "existing\n");
    const source = path.join(workspaceRoot, "incoming", "report.pdf");
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(path.dirname(source), { recursive: true }),
    );
    await writeFile(source, "new copy\n");

    const saved = await importFilesToWorkspaceRoot({
      workspaceRoot,
      sourcePaths: [source],
    });

    expect(saved[0]?.name).toMatch(/^report-[a-f0-9]{8}\.pdf$/);
    expect(await readFile(path.join(workspaceRoot, "report.pdf"), "utf8")).toBe(
      "existing\n",
    );
  });

  it("rejects files larger than the cap", async () => {
    const workspaceRoot = await tempWorkspace();
    const source = path.join(workspaceRoot, "big.bin");
    await writeFile(source, Buffer.alloc(MAX_WORKSPACE_UPLOAD_BYTES + 1));

    await expect(
      importFilesToWorkspaceRoot({
        workspaceRoot,
        sourcePaths: [source],
      }),
    ).rejects.toThrow(/exceeds/);
  });
});
