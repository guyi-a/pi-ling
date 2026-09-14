import { describe, expect, it } from "vitest";

import {
  resolveEditorLanguage,
  type EditorLanguageId,
} from "./editor-language";

describe("resolveEditorLanguage", () => {
  it("maps TypeScript and JavaScript variants to the JS parser", () => {
    for (const name of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mjs", "a.cjs"]) {
      expect(resolveEditorLanguage(name), name).toBe("javascript");
    }
  });

  it("maps the languages that have dedicated packages", () => {
    const cases: Array<[string, EditorLanguageId]> = [
      ["a.py", "python"],
      ["a.json", "json"],
      ["a.md", "markdown"],
      ["a.html", "html"],
      ["a.css", "css"],
      ["a.scss", "css"],
      ["a.sql", "sql"],
      ["a.yml", "yaml"],
      ["a.java", "java"],
      ["a.php", "php"],
      ["a.rs", "rust"],
      ["a.go", "go"],
      ["a.cpp", "cpp"],
      ["a.c", "cpp"],
    ];
    for (const [name, expected] of cases) {
      expect(resolveEditorLanguage(name), name).toBe(expected);
    }
  });

  it("is case insensitive", () => {
    expect(resolveEditorLanguage("A.TS")).toBe("javascript");
    expect(resolveEditorLanguage("Makefile.PY")).toBe("python");
  });

  it("accepts a path and only inspects the last segment", () => {
    expect(resolveEditorLanguage("src/main/lib/util.ts")).toBe("javascript");
    expect(resolveEditorLanguage("E:\\pi-ling\\a.py")).toBe("python");
  });

  it("falls back to plaintext for unknown or absent extensions", () => {
    expect(resolveEditorLanguage("a.unknownext")).toBe("plaintext");
    expect(resolveEditorLanguage("LICENSE")).toBe("plaintext");
    expect(resolveEditorLanguage("Makefile")).toBe("plaintext");
    expect(resolveEditorLanguage("")).toBe("plaintext");
    expect(resolveEditorLanguage(".gitignore")).toBe("plaintext");
  });

  it("does not guess languages without a dedicated package", () => {
    // xml / bash 没有官方 lang 包，宁可回退也不要乱挂解析器
    expect(resolveEditorLanguage("a.xml")).toBe("plaintext");
    expect(resolveEditorLanguage("a.sh")).toBe("plaintext");
  });
});
