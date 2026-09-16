import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  RENDERER_LANGUAGE,
  RENDERER_SANITIZE_CONFIG,
  cssReferencesExternalResource,
  isInlineUri,
  parseRendererMeta,
  sanitizeRendererHtml,
  shouldDropExternalUri,
  tagRendererCodeFences,
  type HtmlPurifier,
} from "./renderer-block";

const MARKDOWN_TSX = readFileSync(
  fileURLToPath(new URL("./Markdown.tsx", import.meta.url)),
  "utf8",
);

const INLINE_RENDERER_TSX = readFileSync(
  fileURLToPath(new URL("./InlineRendererView.tsx", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("parseRendererMeta", () => {
  it("accepts the canonical form Streamdown actually delivers", () => {
    // 实测：```html type="renderer" → meta 原样收到 'type="renderer"'
    expect(parseRendererMeta('type="renderer"')).toBe(true);
  });

  it("accepts single quotes and unquoted values", () => {
    expect(parseRendererMeta("type='renderer'")).toBe(true);
    expect(parseRendererMeta("type=renderer")).toBe(true);
  });

  it("accepts a bare renderer token", () => {
    // 实测：```html renderer → meta = 'renderer'
    expect(parseRendererMeta("renderer")).toBe(true);
  });

  it("still matches when other metadata shares the info string", () => {
    expect(parseRendererMeta('type="renderer" title="架构"')).toBe(true);
    expect(parseRendererMeta('title="架构" type="renderer"')).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(parseRendererMeta('TYPE="RENDERER"')).toBe(true);
  });

  it("rejects plain code fences", () => {
    expect(parseRendererMeta(undefined)).toBe(false);
    expect(parseRendererMeta("")).toBe(false);
    expect(parseRendererMeta("   ")).toBe(false);
    expect(parseRendererMeta("html")).toBe(false);
    expect(parseRendererMeta("ts")).toBe(false);
  });

  it("does not match substrings of a longer word", () => {
    // 保护性用例：避免 "renderers" / "myrenderer" 这类词被误认为标记
    expect(parseRendererMeta("renderers")).toBe(false);
    expect(parseRendererMeta("notrenderer")).toBe(false);
    expect(parseRendererMeta("typex=renderer")).toBe(false);
  });
});

describe("tagRendererCodeFences", () => {
  it("rewrites a renderer fence to the sentinel language", () => {
    const input = [
      "结论见下图。",
      "",
      '```html type="renderer"',
      "<svg><circle r=\"4\"/></svg>",
      "```",
    ].join("\n");
    expect(tagRendererCodeFences(input)).toBe(
      [
        "结论见下图。",
        "",
        `\`\`\`${RENDERER_LANGUAGE}`,
        "<svg><circle r=\"4\"/></svg>",
        "```",
      ].join("\n"),
    );
  });

  it("handles svg fences and single quotes", () => {
    const input = "```svg type='renderer'\n<rect/>\n```";
    expect(tagRendererCodeFences(input)).toBe(
      `\`\`\`${RENDERER_LANGUAGE}\n<rect/>\n\`\`\``,
    );
  });

  it("leaves ordinary html and svg code blocks untouched", () => {
    // 这是本方案的核心保证：注册哨兵语言而不是 html/svg，
    // 普通代码示例的语法高亮与容器完全不受影响。
    for (const input of [
      "```html\n<div>示例</div>\n```",
      "```svg\n<rect/>\n```",
      "```html title=\"示例\"\n<div/>\n```",
    ]) {
      expect(tagRendererCodeFences(input)).toBe(input);
    }
  });

  it("does not rewrite the closing fence", () => {
    const input = "```html\n<div/>\n```";
    expect(tagRendererCodeFences(input)).toBe(input);
  });

  it("does not treat fences inside a fence body as new fences", () => {
    // 围栏里出现的裸 ``` 是正文，不能被当成新的开围栏
    const input = [
      "````html",
      "示例：",
      "```",
      "<div/>",
      "````",
    ].join("\n");
    expect(tagRendererCodeFences(input)).toBe(input);
  });

  it("respects longer fences without closing them early", () => {
    const input = [
      "````html renderer",
      "```",
      "<div/>",
      "````",
    ].join("\n");
    expect(tagRendererCodeFences(input)).toBe(
      [`\`\`\`\`${RENDERER_LANGUAGE}`, "```", "<div/>", "````"].join("\n"),
    );
  });

  it("handles a fence that is still streaming", () => {
    const input = '```html type="renderer"\n<svg><circle';
    expect(tagRendererCodeFences(input)).toBe(
      `\`\`\`${RENDERER_LANGUAGE}\n<svg><circle`,
    );
  });

  it("handles multiple renderer fences in one message", () => {
    const input = [
      '```html type="renderer"',
      "<div>一</div>",
      "```",
      "",
      "说明",
      "",
      '```html type="renderer"',
      "<div>二</div>",
      "```",
    ].join("\n");
    const tagged = tagRendererCodeFences(input);
    expect(tagged.match(new RegExp(RENDERER_LANGUAGE, "g"))).toHaveLength(2);
  });
});

describe("sanitize contract", () => {
  it("forbids every script-executing or navigation-hijacking tag", () => {
    const forbidden = RENDERER_SANITIZE_CONFIG.FORBID_TAGS as string[];
    for (const tag of [
      "script",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
      "form",
      // SVG 里嵌 HTML 的通道，不挡掉就绕过了「只允许 SVG」的意图
      "foreignObject",
    ]) {
      expect(forbidden, tag).toContain(tag);
    }
  });

  it("forbids inline event handler attributes", () => {
    const forbidden = RENDERER_SANITIZE_CONFIG.FORBID_ATTR as string[];
    for (const attr of ["onerror", "onload", "onclick", "srcdoc"]) {
      expect(forbidden, attr).toContain(attr);
    }
  });

  it("allows HTML and SVG rendering profiles so shapes and filters work", () => {
    expect(RENDERER_SANITIZE_CONFIG.USE_PROFILES).toEqual({
      html: true,
      svg: true,
      svgFilters: true,
    });
  });

  it("does not override ALLOWED_URI_REGEXP", () => {
    /*
     * 踩过的坑，必须钉住：本意是「只允许内联引用」，于是传了个
     * `/^(?:#|data:)/` 进去，结果整个 SVG 被剥成光壳 —— viewBox / x / y /
     * width / height / fill / stroke / font-size 全没了，只剩 id 和 role。
     *
     * 原因：DOMPurify 用 `IS_ALLOWED_URI` 判断「属性名像不像 URI 属性」，
     * 而几乎任何纯字母属性名都能匹配（一路吃到 `$`），于是每个属性值都要过
     * ALLOWED_URI_REGEXP，`150` / `var(--x)` / `middle` 全被判非法。
     *
     * 外部 URI 改由 `shouldDropExternalUri` 钩子按属性名精确处理。
     */
    expect(RENDERER_SANITIZE_CONFIG).not.toHaveProperty("ALLOWED_URI_REGEXP");
  });

  it("does not enable risky escape hatches", () => {
    expect(RENDERER_SANITIZE_CONFIG.ALLOW_UNKNOWN_PROTOCOLS).toBe(false);
    expect(RENDERER_SANITIZE_CONFIG.ALLOW_DATA_ATTR).toBe(false);
  });
});

describe("isInlineUri", () => {
  it("accepts anchors and inline images", () => {
    expect(isInlineUri("#section")).toBe(true);
    expect(isInlineUri("  #a  ")).toBe(true);
    expect(isInlineUri("data:image/png;base64,AAAA")).toBe(true);
    expect(isInlineUri("")).toBe(true); // 空值不产生请求
  });

  it("rejects everything that could hit the network", () => {
    for (const external of [
      "https://example.com/a.png",
      "http://example.com/a.png",
      "//example.com/a.png",
      "/local/a.png",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      expect(isInlineUri(external), external).toBe(false);
    }
  });
});

describe("shouldDropExternalUri", () => {
  it("drops external URIs on URI-bearing attributes", () => {
    expect(shouldDropExternalUri("href", "https://example.com")).toBe(true);
    expect(shouldDropExternalUri("src", "http://example.com/a.png")).toBe(true);
    expect(shouldDropExternalUri("xlink:href", "//example.com/a")).toBe(true);
    expect(shouldDropExternalUri("SRC", "https://example.com")).toBe(true);
  });

  it("keeps inline references", () => {
    expect(shouldDropExternalUri("href", "#node-a")).toBe(false);
    expect(shouldDropExternalUri("src", "data:image/png;base64,AA")).toBe(false);
  });

  it("leaves non-URI attributes alone", () => {
    /*
     * 这一组正是上面那个坑的回归测试。fill / stroke / viewBox / x / y / width /
     * height / text-anchor 都不是 URI 属性，无论取什么值都不能被判定为外部引用。
     */
    for (const [name, value] of [
      ["fill", "var(--text)"],
      ["stroke", "#fff"],
      ["viewBox", "0 0 560 150"],
      ["x", "83"],
      ["y", "61"],
      ["width", "150"],
      ["height", "52"],
      ["text-anchor", "middle"],
      ["font-size", "14"],
      ["marker-end", "url(#a)"],
      ["rx", "9"],
      ["d", "M0,0 L9,4.5 L0,9 z"],
      ["opacity", "0.5"],
      ["stroke-width", "1.5"],
    ] as const) {
      expect(shouldDropExternalUri(name, value), `${name}=${value}`).toBe(false);
    }
  });

  it("drops a style attribute that pulls a remote resource", () => {
    expect(
      shouldDropExternalUri("style", "background: url(https://example.com/a.png)"),
    ).toBe(true);
    expect(
      shouldDropExternalUri("style", "background:url('http://x/y.png')"),
    ).toBe(true);
  });

  it("keeps an ordinary style attribute", () => {
    for (const css of [
      "fill: var(--text)",
      "font-size: 14px; font-weight: 600",
      "background: linear-gradient(90deg, #fff, #eee)",
      "background: url(#gradient)", // data:image 之外的内联锚点在 SVG 里是滤镜引用
    ]) {
      expect(shouldDropExternalUri("style", css), css).toBe(false);
    }
  });
});

describe("cssReferencesExternalResource", () => {
  it("flags @import unconditionally", () => {
    expect(cssReferencesExternalResource('@import url("https://x/y.css")')).toBe(
      true,
    );
    expect(cssReferencesExternalResource("@import 'x.css';")).toBe(true);
  });

  it("flags url() pointing outward", () => {
    expect(cssReferencesExternalResource("a{background:url(https://x/y.png)}")).toBe(
      true,
    );
    expect(cssReferencesExternalResource("a{background:url(http://x/y.png)}")).toBe(
      true,
    );
    expect(cssReferencesExternalResource("a{background:url(//x/y.png)}")).toBe(true);
  });

  it("allows inline-only CSS", () => {
    expect(
      cssReferencesExternalResource("svg{fill:var(--text)} #a{stroke:#fff}"),
    ).toBe(false);
    expect(cssReferencesExternalResource("a{background:url(data:image/gif;base64,AA)}")).toBe(false);
    expect(cssReferencesExternalResource("a{background:url(#grad)}")).toBe(false);
    expect(cssReferencesExternalResource("")).toBe(false);
  });
});

describe("sanitizeRendererHtml", () => {
  it("passes the pinned config to the purifier", () => {
    // 关键契约：配置必须**原样**传下去。若有人改成传内联对象或漏传参数，
    // 上面那一组「消毒配置」断言就形同虚设 —— 它们只保护了常量本身。
    const purifier: HtmlPurifier = { sanitize: vi.fn(() => "<p>ok</p>") };
    const result = sanitizeRendererHtml("<p>ok</p>", purifier);
    expect(purifier.sanitize).toHaveBeenCalledWith(
      "<p>ok</p>",
      RENDERER_SANITIZE_CONFIG,
    );
    expect(result).toEqual({ ok: true, html: "<p>ok</p>" });
  });

  it("reports failure instead of throwing when the purifier blows up", () => {
    const purifier: HtmlPurifier = {
      sanitize: () => {
        throw new Error("boom");
      },
    };
    const result = sanitizeRendererHtml("<div/>", purifier);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("boom");
  });

  it("treats fully-stripped output as a failure, not a blank figure", () => {
    // 内容被全部剥掉时不能静默留白 —— 调用方要据此降级显示原始内容
    const purifier: HtmlPurifier = { sanitize: () => "   " };
    expect(sanitizeRendererHtml("<script>x</script>", purifier).ok).toBe(false);
  });

  it("rejects empty input up front", () => {
    const purifier: HtmlPurifier = { sanitize: vi.fn(() => "<p/>") };
    expect(sanitizeRendererHtml("   ", purifier).ok).toBe(false);
    expect(purifier.sanitize).not.toHaveBeenCalled();
  });
});

describe("Markdown wiring contract", () => {
  it("registers a renderer for the sentinel language only", () => {
    const source = stripComments(MARKDOWN_TSX);
    const renderers = source.match(/renderers:\s*\[[\s\S]*?\n {6}\],/)?.[0] ?? "";
    expect(renderers).toContain("RENDERER_LANGUAGE");
    expect(renderers).toContain("InlineRendererView");
    // 直接注册 html / svg 会命中普通代码块、丢掉默认的语法高亮与复制按钮，
    // 所以这里反向钉住：不允许出现这两个语言。
    expect(renderers).not.toMatch(/"html"/);
    expect(renderers).not.toMatch(/"svg"/);
  });

  it("applies the fence rewrite before rendering", () => {
    expect(stripComments(MARKDOWN_TSX)).toContain(
      "tagRendererCodeFences(props.children)",
    );
  });
});

describe("source toggle contract", () => {
  const CHAT_CSS = readFileSync(
    fileURLToPath(new URL("../../styles/chat.css", import.meta.url)),
    "utf8",
  );

  it("hides the shadow host when the hidden attribute is set", () => {
    /*
     * 踩过的坑：组件用 `hidden` 属性隐藏 host，但 chat.css 里给
     * `.inline-render-host` 写了 `display: block` —— 作者样式表会覆盖 UA 样式表
     * 的 `[hidden] { display: none }`，导致切到源码时**图和源码同时显示**。
     *
     * 只断言「设了 hidden 属性」是不够的（那只是 property 为 true），
     * 必须显式补一条更高特异性的规则。这条断言把该规则钉住。
     */
    expect(CHAT_CSS).toMatch(/\.inline-render-host\[hidden\]\s*\{[^}]*display:\s*none/);
    expect(stripComments(CHAT_CSS)).toMatch(
      /\.inline-render-host\s*\{[^}]*display:\s*block/,
    );
  });

  it("does not render the figure and the source at the same time", () => {
    // 源码模式下渲染容器必须被标记 hidden，且两者由同一个 sourceMode 驱动
    expect(INLINE_RENDERER_TSX).toContain("hidden={sourceMode}");
    expect(INLINE_RENDERER_TSX).toContain("{sourceMode ? (");
  });
});
