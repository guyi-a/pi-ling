import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Workspace } from "../src/index.js";

describe("Workspace.grep", () => {
  let root = "";
  let workspace: Workspace;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-grep-"));
    workspace = await Workspace.open(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function write(relative: string, content: string): Promise<void> {
    const absolute = path.join(root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content);
  }

  it("finds matches with path and 1-based line numbers", async () => {
    await write("src/a.ts", "const alpha = 1;\nconst target = 2;\n");
    await write("src/b.ts", "// target here\n");

    const matches = await workspace.grep("target");
    expect(matches).toEqual([
      { path: "src/a.ts", line: 2, text: "const target = 2;" },
      { path: "src/b.ts", line: 1, text: "// target here" },
    ]);
  });

  it("matches case-insensitively and treats the pattern as a regex", async () => {
    await write("a.ts", "const UseState = 1;\n");
    expect((await workspace.grep("usestate")).length).toBe(1);
    expect((await workspace.grep("Use.*State")).length).toBe(1);
  });

  it("preserves file order and line order across the concurrency batch", async () => {
    // 文件数刻意超过批大小（32），覆盖「跨批收集」与「批内收集」两条路径
    const total = 80;
    for (let index = 0; index < total; index += 1) {
      const name = `f${String(index).padStart(3, "0")}.txt`;
      await write(name, `hit ${index}\nhit again ${index}\n`);
    }

    const matches = await workspace.grep("hit");
    // 每文件 2 行 → 160 条；顺序必须是文件序 + 行序
    expect(matches.length).toBe(total * 2);
    for (let index = 0; index < total; index += 1) {
      const name = `f${String(index).padStart(3, "0")}.txt`;
      expect(matches[index * 2]).toEqual({
        path: name,
        line: 1,
        text: `hit ${index}`,
      });
      expect(matches[index * 2 + 1]).toEqual({
        path: name,
        line: 2,
        text: `hit again ${index}`,
      });
    }
  });

  it("stops at maxMatches", async () => {
    for (let index = 0; index < 10; index += 1) {
      await write(`g${index}.txt`, "match\nmatch\nmatch\n");
    }
    expect((await workspace.grep("match", ".", 5000, 5)).length).toBe(5);
  });

  it("skips binary files instead of returning mojibake", async () => {
    await fs.writeFile(
      path.join(root, "blob.bin"),
      Buffer.from([0x00, 0x01, 0x02, 0x6d, 0x61, 0x74, 0x63, 0x68, 0x00]),
    );
    await write("text.txt", "match\n");

    const matches = await workspace.grep("match");
    expect(matches).toEqual([
      { path: "text.txt", line: 1, text: "match" },
    ]);
  });

  it("skips files above the size limit", async () => {
    await write("big.txt", "x".repeat(600 * 1024));
    await write("ok.txt", "match\n");

    const matches = await workspace.grep("match");
    expect(matches.map((match) => match.path)).toEqual(["ok.txt"]);
  });

  it("returns an empty list when nothing matches", async () => {
    await write("a.txt", "nothing here\n");
    expect(await workspace.grep("definitely_absent_xyz")).toEqual([]);
  });

  it("scopes the search to a subdirectory", async () => {
    await write("src/in.txt", "match\n");
    await write("other/out.txt", "match\n");

    const matches = await workspace.grep("match", "src");
    expect(matches.map((match) => match.path)).toEqual(["src/in.txt"]);
  });
});

describe("Workspace.list", () => {
  let root = "";
  let workspace: Workspace;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-list-"));
    workspace = await Workspace.open(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("keeps readdir order with files interleaved between directories", async () => {
    // 名字刻意让 readdir 的字典序把目录夹在文件之间：
    // a.txt, b-dir/, c.txt, d-dir/, e.txt
    await fs.writeFile(path.join(root, "a.txt"), "a");
    await fs.mkdir(path.join(root, "b-dir"));
    await fs.writeFile(path.join(root, "b-dir", "inner.txt"), "b");
    await fs.writeFile(path.join(root, "c.txt"), "c");
    await fs.mkdir(path.join(root, "d-dir"));
    await fs.writeFile(path.join(root, "e.txt"), "e");

    const entries = await workspace.list(".", true);
    expect(entries.map((entry) => entry.path)).toEqual([
      "a.txt",
      "b-dir",
      "b-dir/inner.txt",
      "c.txt",
      "d-dir",
      "e.txt",
    ]);
  });

  it("reports file sizes so oversized files can be filtered", async () => {
    await fs.writeFile(path.join(root, "small.txt"), "12345");
    const entries = await workspace.list(".", true);
    expect(entries).toEqual([
      { path: "small.txt", type: "file", size: 5 },
    ]);
  });

  it("honours maxEntries", async () => {
    for (let index = 0; index < 10; index += 1) {
      await fs.writeFile(path.join(root, `f${index}.txt`), "x");
    }
    expect((await workspace.list(".", true, 4)).length).toBeLessThanOrEqual(4);
  });
});
