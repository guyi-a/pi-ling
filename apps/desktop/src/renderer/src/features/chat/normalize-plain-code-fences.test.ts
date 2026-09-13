import { describe, expect, it } from "vitest";

import {
  detectFenceLanguage,
  tagPlainCodeFenceOpenings,
} from "./normalize-plain-code-fences";

describe("detectFenceLanguage", () => {
  it("detects Python from def / bare import / print", () => {
    expect(
      detectFenceLanguage("import sys\n\ndef main():\n    print(len(sys.argv))"),
    ).toBe("python");
    expect(detectFenceLanguage("from pathlib import Path\nx = 1")).toBe("python");
    expect(detectFenceLanguage("for i in range(n):\n    total += a[i]")).toBe(
      "python",
    );
    expect(detectFenceLanguage("class Solver:\n    pass")).toBe("python");
  });

  it("does not mistake JavaScript imports for Python", () => {
    expect(
      detectFenceLanguage('import { useState } from "react"\nconst a = 1'),
    ).toBe("javascript");
  });

  it("detects JavaScript and TypeScript", () => {
    expect(detectFenceLanguage("const a = 1\nlet b = 2")).toBe("javascript");
    expect(detectFenceLanguage("[1, 2].map((x) => x * 2)")).toBe("javascript");
    expect(
      detectFenceLanguage("interface Foo {\n  bar: string\n}\nconst f: Foo = {}"),
    ).toBe("typescript");
    expect(detectFenceLanguage("function add(a: number, b: number): number {}")).toBe(
      "typescript",
    );
  });

  it("detects JSON only when it actually parses", () => {
    expect(detectFenceLanguage('{"a": 1, "b": [2]}')).toBe("json");
    // 长得像但不是合法 JSON —— 不能误判
    expect(detectFenceLanguage("{ not: json }")).toBeUndefined();
  });

  it("detects shell", () => {
    expect(detectFenceLanguage("$ pnpm install")).toBe("bash");
    expect(detectFenceLanguage("git status\npnpm build")).toBe("bash");
  });

  it("detects SQL", () => {
    expect(detectFenceLanguage("SELECT id FROM users WHERE id = 1")).toBe("sql");
  });

  it("keeps diagrams unlabeled so colors do not break the structure", () => {
    const diagram = [
      "Renderer (React UI)",
      "   ↕ IPC",
      "Main Process",
      "   └─ CodexAgentSession",
    ].join("\n");
    expect(detectFenceLanguage(diagram)).toBeUndefined();
  });

  it("returns undefined for prose and empty input", () => {
    expect(detectFenceLanguage("恰好一次，每株至多尝试一次")).toBeUndefined();
    expect(detectFenceLanguage("")).toBeUndefined();
    expect(detectFenceLanguage("   \n  ")).toBeUndefined();
  });
});

describe("tagPlainCodeFenceOpenings", () => {
  it("tags an unlabeled Python fence with its detected language", () => {
    const input = "```\nimport sys\ndef main():\n    print(1)\n```";
    expect(tagPlainCodeFenceOpenings(input)).toBe(
      "```python\nimport sys\ndef main():\n    print(1)\n```",
    );
  });

  it("falls back to text when the language cannot be detected", () => {
    const input = "```\nsome plain prose\nanother line\n```";
    expect(tagPlainCodeFenceOpenings(input)).toBe(
      "```text\nsome plain prose\nanother line\n```",
    );
  });

  it("does not rewrite closing fences", () => {
    const input = "```\nline\n```\n\n**body**";
    expect(tagPlainCodeFenceOpenings(input)).toBe(
      "```text\nline\n```\n\n**body**",
    );
  });

  it("leaves explicitly labeled fences unchanged", () => {
    const input = "```ts\nconst ok = true\n```";
    expect(tagPlainCodeFenceOpenings(input)).toBe(input);
  });

  it("handles a fence that is still streaming (no closing fence yet)", () => {
    const input = "```\nimport sys\ndef main():";
    expect(tagPlainCodeFenceOpenings(input)).toBe(
      "```python\nimport sys\ndef main():",
    );
  });

  it("handles multiple fences in one message", () => {
    const input = [
      "```",
      "import sys",
      "```",
      "",
      "说明文字",
      "",
      "```",
      "const a = 1",
      "```",
    ].join("\n");
    expect(tagPlainCodeFenceOpenings(input)).toBe(
      [
        "```python",
        "import sys",
        "```",
        "",
        "说明文字",
        "",
        "```javascript",
        "const a = 1",
        "```",
      ].join("\n"),
    );
  });

  it("respects longer fences without closing them early", () => {
    const input = "````\nimport sys\n```\nstill inside\n````";
    expect(tagPlainCodeFenceOpenings(input)).toBe(
      "````python\nimport sys\n```\nstill inside\n````",
    );
  });
});
