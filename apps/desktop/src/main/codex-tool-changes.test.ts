import path from "node:path";

import { describe, expect, it } from "vitest";

import { isFileAffectingCodexTool, resolveToolWorkspacePath } from "./codex-tool-changes.js";

const ROOT = path.resolve("E:/pi-ling");

describe("resolveToolWorkspacePath for Codex input", () => {
  it("converts the absolute path Codex puts in fileChange.changes[]", () => {
    // 回归：这是真实会话里 write_file 的参数形状（见截图）。路径为绝对路径，
    // 直接交给 ChangeTracker.capture() 会抛 "Absolute paths are not allowed"，
    // 而调用方静默忽略 → 变更永远记录不到 → Last Agent Run 恒为空。
    expect(
      resolveToolWorkspacePath(
        {
          changes: [
            {
              path: "E:\\pi-ling\\docs\\interview\\klingwork\\Subagent委派.md",
              kind: { type: "add" },
              diff: "# KlingWork · Subagent 委派",
            },
          ],
        },
        ROOT,
      ),
    ).toBe("docs/interview/klingwork/Subagent委派.md");
  });

  it("normalizes a relative path from a normalized shell command", () => {
    // normalizeCodexCommandTool 从 Add-Content 提取出相对路径
    expect(
      resolveToolWorkspacePath(
        { command: 'Add-Content -LiteralPath a.md -Value x', path: "a.md" },
        ROOT,
      ),
    ).toBe("a.md");
  });

  it("accepts a nested absolute path from another drive only when inside root", () => {
    expect(
      resolveToolWorkspacePath({ changes: [{ path: "E:/pi-ling/src/a.ts" }] }, ROOT),
    ).toBe("src/a.ts");
  });

  it("rejects paths outside the workspace", () => {
    expect(
      resolveToolWorkspacePath({ changes: [{ path: "E:/elsewhere/a.ts" }] }, ROOT),
    ).toBeUndefined();
    expect(resolveToolWorkspacePath({ path: "../escape.ts" }, ROOT)).toBeUndefined();
  });

  it("returns undefined when there is no usable path", () => {
    expect(resolveToolWorkspacePath({ command: "ls" }, ROOT)).toBeUndefined();
    expect(resolveToolWorkspacePath({ changes: [] }, ROOT)).toBeUndefined();
    expect(resolveToolWorkspacePath({ path: "   " }, ROOT)).toBeUndefined();
  });

  it("never returns an absolute path, which capture() would reject", () => {
    const resolved = resolveToolWorkspacePath(
      { changes: [{ path: path.join(ROOT, "src", "a.ts") }] },
      ROOT,
    );
    expect(resolved).toBeDefined();
    expect(path.isAbsolute(resolved!)).toBe(false);
  });
});

describe("isFileAffectingCodexTool", () => {
  it("accepts write/edit titles and the edit kind", () => {
    expect(isFileAffectingCodexTool("write_file")).toBe(true);
    expect(isFileAffectingCodexTool("edit_file")).toBe(true);
    expect(isFileAffectingCodexTool("anything", "edit")).toBe(true);
  });

  it("rejects read-only tools", () => {
    expect(isFileAffectingCodexTool("run_command")).toBe(false);
    expect(isFileAffectingCodexTool("read_file", "read")).toBe(false);
    expect(isFileAffectingCodexTool("web_search", "search")).toBe(false);
  });
});
