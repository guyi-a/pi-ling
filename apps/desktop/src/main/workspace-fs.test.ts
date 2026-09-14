import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildWorkspaceTree,
  readFileContent,
  resolveWorkspacePath,
} from "./workspace-fs.js";

describe("dot entries in the workspace tree", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pi-ling-dot-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function treePaths(): Promise<string[]> {
    const tree = await buildWorkspaceTree(root);
    return tree.entries.map((entry) => entry.path);
  }

  it("shows dotfiles and dot-directories", async () => {
    // 这些以前被整类跳过；.env 是唯一的例外
    await writeFile(path.join(root, ".gitignore"), "node_modules/\n");
    await writeFile(path.join(root, ".editorconfig"), "root = true\n");
    await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
    await writeFile(
      path.join(root, ".github", "workflows", "ci.yml"),
      "name: CI\n",
    );
    await mkdir(path.join(root, ".vscode"), { recursive: true });
    await writeFile(path.join(root, ".vscode", "settings.json"), "{}\n");

    const paths = await treePaths();
    expect(paths).toContain(".gitignore");
    expect(paths).toContain(".editorconfig");
    expect(paths).toContain(".github/");
    expect(paths).toContain(".github/workflows/");
    expect(paths).toContain(".github/workflows/ci.yml");
    expect(paths).toContain(".vscode/");
    expect(paths).toContain(".vscode/settings.json");
  });

  it("skips symlinks and junctions instead of showing broken entries", async () => {
    /*
     * 本仓库的 `.dsh-source` 就是指向仓库外的 junction。链接的
     * `dirent.isDirectory()` 为 false，不特殊处理会被当成**文件**加进树 ——
     * 点开却报 "Not a file"。而且递归链接有成环与越界的风险。
     */
    await mkdir(path.join(root, "real-dir"), { recursive: true });
    await writeFile(path.join(root, "real-file.txt"), "hi\n");
    try {
      await symlink(
        path.join(root, "real-dir"),
        path.join(root, ".linked-dir"),
        "junction",
      );
    } catch {
      // Windows 上 junction 需要权限；环境不支持就跳过这条
      return;
    }

    const paths = await treePaths();
    expect(paths).not.toContain(".linked-dir");
    // 正常条目不受影响
    expect(paths).toContain("real-dir/");
    expect(paths).toContain("real-file.txt");
  });

  it("still shows .env and .env.* files", async () => {
    await writeFile(path.join(root, ".env"), "TOKEN=1\n");
    await writeFile(path.join(root, ".env.example"), "TOKEN=\n");

    const paths = await treePaths();
    expect(paths).toContain(".env");
    expect(paths).toContain(".env.example");
  });

  it("keeps pruning VCS internals", async () => {
    // 放开点开头目录后，这些必须显式排除，否则会占满条目上限
    await mkdir(path.join(root, ".git", "objects"), { recursive: true });
    await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(
      path.join(root, ".git", "objects", "ab1234"),
      "blob\n",
    );
    await mkdir(path.join(root, ".svn"), { recursive: true });

    const paths = await treePaths();
    expect(paths.some((p) => p.includes(".git"))).toBe(false);
    expect(paths.some((p) => p.includes(".svn"))).toBe(false);
  });

  it("keeps pruning vendored dot-directories", async () => {
    // .dsh-source 在本仓库实测有 7 万个文件，性质等同于 vendor/
    await mkdir(path.join(root, ".dsh-source", "packages", "x"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, ".dsh-source", "packages", "x", "index.ts"),
      "export {};\n",
    );

    const paths = await treePaths();
    expect(paths.some((p) => p.includes(".dsh-source"))).toBe(false);
  });

  it("prunes OS metadata files", async () => {
    await writeFile(path.join(root, ".DS_Store"), "junk");
    await writeFile(path.join(root, ".keep"), "");

    const paths = await treePaths();
    expect(paths).not.toContain(".DS_Store");
    // 但其他点开头文件要保留
    expect(paths).toContain(".keep");
  });

  it("lets the explorer reach files inside a dot-directory", async () => {
    // 「放开」的完整含义：不只是显示目录行，还要能走进去
    await mkdir(path.join(root, ".cursor", "rules"), { recursive: true });
    await writeFile(
      path.join(root, ".cursor", "rules", "a.mdc"),
      "---\ndescription: x\n---\n",
    );

    const paths = await treePaths();
    expect(paths).toContain(".cursor/");
    expect(paths).toContain(".cursor/rules/");
    expect(paths).toContain(".cursor/rules/a.mdc");
  });
});

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
