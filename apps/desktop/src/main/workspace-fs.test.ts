import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildWorkspaceTree,
  readFileContent,
  resolveWorkspacePath,
} from "./workspace-fs.js";

describe("workspace-fs", () => {
  it("prunes heavy directories from the tree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-ling-tree-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src", "main.ts"), "export {};\n");
      await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
      await writeFile(
        path.join(root, "node_modules", "pkg", "index.js"),
        "module.exports = {};\n",
      );

      const tree = await buildWorkspaceTree(root);
      const paths = tree.entries.map((entry) => entry.path);
      expect(paths).toContain("src/");
      expect(paths).toContain("src/main.ts");
      expect(paths.some((entry) => entry.includes("node_modules"))).toBe(
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects paths that escape the workspace root", () => {
    expect(() =>
      resolveWorkspacePath("C:\\workspace", "..\\secret.txt"),
    ).toThrow(/escapes workspace root/);
  });

  it("truncates text files at 512KB", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-ling-file-"));
    try {
      const content = "a".repeat(600 * 1024);
      await writeFile(path.join(root, "large.txt"), content, "utf8");

      const file = await readFileContent(root, "large.txt");
      expect(file.kind === "text" || file.kind === "markdown").toBe(true);
      if (file.kind === "text" || file.kind === "markdown") {
        expect(file.truncated).toBe(true);
        expect(file.content.length).toBeLessThanOrEqual(512 * 1024);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects binary content even for text-like extensions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-ling-bin-"));
    try {
      await writeFile(
        path.join(root, "fake.txt"),
        Buffer.from([0x00, 0x01, 0x02, 0x03]),
      );

      const file = await readFileContent(root, "fake.txt");
      expect(file.kind).toBe("binary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
