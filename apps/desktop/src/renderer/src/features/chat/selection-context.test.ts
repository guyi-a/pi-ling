import { describe, expect, it } from "vitest";

import {
  assembleExcerpt,
  capSnippetText,
  chatSource,
  composePromptWithContext,
  formatFileSource,
  formatSnippetBlock,
  MARKER_SENTINEL,
  placeToolbar,
  shouldOfferAddToChat,
  snippetPreview,
  type ContextSnippet,
} from "./selection-context";

function snippet(text: string, label?: string): ContextSnippet {
  return {
    id: "s1",
    text,
    ...(label ? { source: { kind: "chat", label } } : {}),
  };
}

describe("formatFileSource", () => {
  it("returns the bare path when there is no line info", () => {
    expect(formatFileSource("src/a.ts")).toBe("src/a.ts");
  });

  it("formats a single line without a redundant range", () => {
    expect(formatFileSource("src/a.ts", 12, 12)).toBe("src/a.ts:12");
    expect(formatFileSource("src/a.ts", 12)).toBe("src/a.ts:12");
  });

  it("formats a line range", () => {
    expect(formatFileSource("src/a.ts", 12, 20)).toBe("src/a.ts:12-20");
  });

  it("ignores an invalid start line", () => {
    expect(formatFileSource("src/a.ts", 0, 5)).toBe("src/a.ts");
  });
});

describe("capSnippetText", () => {
  it("keeps short text untouched", () => {
    expect(capSnippetText("hello", 100)).toEqual({
      text: "hello",
      truncated: false,
    });
  });

  it("truncates and says so explicitly", () => {
    const result = capSnippetText("x".repeat(50), 10);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith("x".repeat(10))).toBe(true);
    // 必须显式告知被截断，不能静默丢内容
    expect(result.text).toContain("已截断");
  });
});

describe("snippetPreview", () => {
  it("collapses whitespace so multi-line quotes stay on one line", () => {
    expect(snippetPreview("a\n\n   b\tc")).toBe("a b c");
  });

  it("truncates long text with an ellipsis", () => {
    expect(snippetPreview("abcdefghij", 4)).toBe("abcd…");
  });
});

describe("formatSnippetBlock", () => {
  it("wraps the quote in bracket markers, not markdown fences", () => {
    // 用户消息在时间线里是纯文本渲染，``` 会显示成字面反引号
    const block = formatSnippetBlock(snippet("def f(): pass", "src/a.py:3"));
    expect(block).toBe("[引用 src/a.py:3]\ndef f(): pass\n[/引用]");
    expect(block).not.toContain("```");
  });

  it("falls back to the chat label when there is no source", () => {
    expect(formatSnippetBlock(snippet("x"))).toContain("[引用 对话记录]");
  });
});

describe("composePromptWithContext", () => {
  it("returns the prompt unchanged when there is no context", () => {
    expect(composePromptWithContext("do it", [])).toBe("do it");
  });

  it("puts quotes before the user's own words", () => {
    const result = composePromptWithContext("帮我改一下", [
      snippet("const a = 1;", "src/a.ts:1"),
    ]);
    const quoteAt = result.indexOf("[引用 src/a.ts:1]");
    const wordsAt = result.indexOf("帮我改一下");
    expect(quoteAt).toBeGreaterThanOrEqual(0);
    // 引用在前、用户的话在后
    expect(quoteAt).toBeLessThan(wordsAt);
  });

  it("joins multiple quotes with a blank line between them", () => {
    const result = composePromptWithContext("q", [
      snippet("first", "a.ts:1"),
      snippet("second", "b.ts:2"),
    ]);
    expect(result).toContain("[/引用]\n\n[引用 b.ts:2]");
  });

  it("returns only the quotes when the user typed nothing", () => {
    // 只加引用就发送是合法用法（"看看这个"）
    const result = composePromptWithContext("   ", [snippet("x", "a.ts:1")]);
    expect(result).toBe("[引用 a.ts:1]\nx\n[/引用]");
  });

  it("trims the user's prompt", () => {
    expect(composePromptWithContext("  hi  ", [])).toBe("hi");
  });
});

describe("assembleExcerpt", () => {
  const S = MARKER_SENTINEL;

  it("replaces sentinels with markers in order", () => {
    const out = assembleExcerpt(
      [{ text: `${S}first\n${S}second`, kind: "list" }],
      ["1.", "2."],
    );
    expect(out).toBe("1. first\n2. second");
  });

  it("lets a sentinel pull the marker to the start of the line", () => {
    // 哨兵是非空白字符，规整会把前面的空白压掉，序号自然落到行首
    const out = assembleExcerpt([{ text: `\n\n${S}甲\n\n\n${S}乙`, kind: "list" }], [
      "-",
      "-",
    ]);
    expect(out).toBe("- 甲\n- 乙");
  });

  it("collapses the blank-line runs that Streamdown emits for ul", () => {
    // 实测原生文本：ul 是 "\n\n无序项甲\n\n\n无序项乙…"，是一串空行
    const out = assembleExcerpt(
      [{ text: "\n\n无序项甲\n\n\n无序项乙\n\n", kind: "list" }],
      [],
    );
    expect(out).toBe("无序项甲\n无序项乙");
  });

  it("preserves pre content byte for byte", () => {
    // 代码缩进是语义的一部分，绝不能被规整
    const code = "def f():\n    if x:\n        return\n\n    return 1";
    const out = assembleExcerpt([{ text: code, kind: "pre" }], []);
    expect(out).toBe(code);
  });

  it("keeps prose paragraphs untouched", () => {
    const prose = "第一段。\n\n第二段。";
    expect(assembleExcerpt([{ text: prose, kind: "text" }], [])).toBe(prose);
  });

  it("normalizes across adjacent segments of the same kind", () => {
    // 跨文本节点的空白串必须一起规整，否则会漏掉
    const out = assembleExcerpt(
      [
        { text: "甲\n", kind: "list" },
        { text: "\n", kind: "list" },
        { text: "\n乙", kind: "list" },
      ],
      [],
    );
    expect(out).toBe("甲\n乙");
  });

  it("trims the assembled result", () => {
    expect(assembleExcerpt([{ text: "\n\n  hi  \n\n", kind: "text" }], [])).toBe(
      "hi",
    );
  });

  it("does not let a pre block inherit list normalization", () => {
    const code = "a\n\n\nb";
    const out = assembleExcerpt(
      [
        { text: "项：\n", kind: "list" },
        { text: code, kind: "pre" },
      ],
      [],
    );
    expect(out).toContain(code);
  });

  it("ignores empty segments", () => {
    expect(
      assembleExcerpt(
        [
          { text: "", kind: "list" },
          { text: "x", kind: "list" },
        ],
        [],
      ),
    ).toBe("x");
  });

  it("leaves a sentinel with no marker as nothing", () => {
    // 防御：标记数量与哨兵不匹配时不要留下可见字符
    expect(assembleExcerpt([{ text: `a${S}b`, kind: "list" }], [])).toBe("ab");
  });
});

describe("shouldOfferAddToChat", () => {
  it("offers for a real selection", () => {
    expect(
      shouldOfferAddToChat({
        text: "some text",
        isCollapsed: false,
        isInsideExcluded: false,
      }),
    ).toBe(true);
  });

  it("does not offer for a collapsed caret", () => {
    expect(
      shouldOfferAddToChat({
        text: "",
        isCollapsed: true,
        isInsideExcluded: false,
      }),
    ).toBe(false);
  });

  it("does not offer inside the composer or other excluded regions", () => {
    expect(
      shouldOfferAddToChat({
        text: "typing here",
        isCollapsed: false,
        isInsideExcluded: true,
      }),
    ).toBe(false);
  });

  it("does not offer for whitespace-only selections", () => {
    expect(
      shouldOfferAddToChat({
        text: "   \n  ",
        isCollapsed: false,
        isInsideExcluded: false,
      }),
    ).toBe(false);
  });
});

describe("placeToolbar", () => {
  const toolbar = { width: 100, height: 28 };
  const viewport = { width: 800, height: 600 };

  it("sits above the selection, centred on it", () => {
    const { left, top } = placeToolbar({
      anchor: { left: 300, top: 200, right: 400, bottom: 220 },
      toolbar,
      viewport,
      gap: 8,
    });
    // 上方：200 - 28 - 8 = 164
    expect(top).toBe(164);
    // 中心 350 - 50 = 300
    expect(left).toBe(300);
  });

  it("flips below when there is not enough room above", () => {
    const { top } = placeToolbar({
      anchor: { left: 300, top: 10, right: 400, bottom: 30 },
      toolbar,
      viewport,
      gap: 8,
    });
    // 下方：30 + 8 = 38
    expect(top).toBe(38);
  });

  it("clamps to the left edge", () => {
    const { left } = placeToolbar({
      anchor: { left: 0, top: 200, right: 20, bottom: 220 },
      toolbar,
      viewport,
      gap: 8,
    });
    expect(left).toBe(8);
  });

  it("clamps to the right edge", () => {
    const { left } = placeToolbar({
      anchor: { left: 780, top: 200, right: 800, bottom: 220 },
      toolbar,
      viewport,
      gap: 8,
    });
    // 800 - 100 - 8 = 692
    expect(left).toBe(692);
  });

  it("stays inside the viewport for a very wide selection", () => {
    const { left, top } = placeToolbar({
      anchor: { left: 0, top: 300, right: 800, bottom: 320 },
      toolbar,
      viewport,
      gap: 8,
    });
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + toolbar.width).toBeLessThanOrEqual(viewport.width);
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it("picks the top gap when neither side fits", () => {
    const tiny = { width: 800, height: 40 };
    const { top } = placeToolbar({
      anchor: { left: 100, top: 20, right: 200, bottom: 30 },
      toolbar,
      viewport: tiny,
      gap: 8,
    });
    expect(top).toBe(8);
  });
});
