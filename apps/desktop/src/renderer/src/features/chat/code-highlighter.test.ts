import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { toHighlightLines } from "./code-highlighter";

function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

/**
 * 实测从 `plugin.highlight()` 拿到的真实形状：
 *   { content: "<", offset: 0, htmlStyle: { "--shiki-dark": "#808080", color: "#800000" } }
 * `color` 是浅色（第一个主题），`--shiki-dark` 是深色（第二个主题）。
 */
const REAL_SHAPE = {
  tokens: [
    [
      { content: "<", offset: 0, htmlStyle: { color: "#800000", "--shiki-dark": "#808080" } },
      { content: "svg", offset: 1, htmlStyle: { color: "#800000", "--shiki-dark": "#569CD6" } },
    ],
    [
      { content: "  ", offset: 0, htmlStyle: { color: "#000000", "--shiki-dark": "#D4D4D4" } },
    ],
  ],
};

describe("toHighlightLines", () => {
  it("maps shiki tokens into light/dark pairs", () => {
    const lines = toHighlightLines(REAL_SHAPE);
    expect(lines).toHaveLength(2);
    expect(lines?.[0]?.tokens).toEqual([
      { content: "<", light: "#800000", dark: "#808080" },
      { content: "svg", light: "#800000", dark: "#569CD6" },
    ]);
    // 空行（只有空白 token）也要保留 —— 丢掉会让源码行号/缩进错乱
    expect(lines?.[1]?.tokens).toEqual([
      { content: "  ", light: "#000000", dark: "#D4D4D4" },
    ]);
  });

  it("keeps plain content when a token carries no colors", () => {
    const lines = toHighlightLines({ tokens: [[{ content: "x" }]] });
    expect(lines).toEqual([{ tokens: [{ content: "x" }] }]);
  });

  it("drops non-string colors instead of leaking junk into CSS vars", () => {
    const lines = toHighlightLines({
      tokens: [
        [
          {
            content: "y",
            htmlStyle: { color: 123, "--shiki-dark": null },
          },
        ],
      ],
    });
    expect(lines).toEqual([{ tokens: [{ content: "y" }] }]);
  });

  it("returns null for shapes it does not understand", () => {
    /*
     * 上游换了 token 结构时，宁可降级为纯文本，也不能把源码渲染成空白。
     * 所以这里一律 null，由调用方回退到原始字符串。
     */
    for (const bad of [
      null,
      undefined,
      "html",
      42,
      {},
      { tokens: null },
      { tokens: "nope" },
      { tokens: [null] },
      { tokens: [[null]] },
      { tokens: [[{ offset: 0 }]] }, // 没有 content
    ]) {
      expect(toHighlightLines(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("preserves token order and exact whitespace", () => {
    const lines = toHighlightLines({
      tokens: [[
        { content: "  " },
        { content: "a" },
        { content: "\n" },
      ]],
    });
    expect(lines?.[0]?.tokens.map((t) => t.content)).toEqual(["  ", "a", "\n"]);
  });
});

/** 剥掉注释再断言，否则解释性注释里的词会误伤负向断言。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("source view highlights with the shared plugin", () => {
  const SOURCE_VIEW_TSX = readSource("./SourceView.tsx");
  const CHAT_CSS = readSource("../../styles/chat.css");

  it("reuses the shared highlighter rather than nesting another markdown renderer", () => {
    expect(SOURCE_VIEW_TSX).toContain('from "./code-highlighter"');
    // 嵌套 Markdown 会把代码块容器/复制按钮一起带进来，形成框套框
    // （先剥注释：本文件的文档注释里正解释了「为什么不用嵌套」）
    const code = stripComments(SOURCE_VIEW_TSX);
    expect(code).not.toContain('from "./Markdown"');
    expect(code).not.toContain("<Markdown");
  });

  it("never renders stale colors against changed source", () => {
    // 高亮是异步的：结果是旧内容时必须退回纯文本，否则颜色与文本错位
    expect(SOURCE_VIEW_TSX).toContain("highlighted.source === props.code");
  });

  it("skips highlighting while streaming", () => {
    // 流式期间内容每来一个分片都会变，反复高亮纯属白费算力
    expect(SOURCE_VIEW_TSX).toMatch(/if \(props\.streaming\) return/);
  });

  it("switches token colors by theme attribute", () => {
    expect(CHAT_CSS).toMatch(
      /\.inline-render-token\s*\{[^}]*var\(--token-dark, var\(--token-light/,
    );
    expect(CHAT_CSS).toMatch(
      /html\[data-theme="light"\] \.inline-render-token\s*\{[^}]*var\(--token-light/,
    );
    // 每行必须是块级，否则整段代码会挤成一行
    expect(CHAT_CSS).toMatch(/\.inline-render-line\s*\{[^}]*display:\s*block/);
  });

  it("strips inline-code chrome so the source has a single frame", () => {
    // `.markdown code` 会给行内代码加内边距/底色/圆角，
    // 不清掉的话整段源码会被当成一个超大行内代码，与外层容器叠成两层框
    expect(CHAT_CSS).toMatch(
      /\.inline-render-source pre code\s*\{[^}]*padding:\s*0/,
    );
    expect(CHAT_CSS).toMatch(
      /\.inline-render-source pre code\s*\{[^}]*background:\s*transparent/,
    );
  });
});
