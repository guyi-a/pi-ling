import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

describe("Markdown link output", () => {
  it("renders a plain markdown link as an anchor with the full href", () => {
    const html = renderToStaticMarkup(
      <Markdown>{"see [Guide](https://electron-vite.org/guide/)"}</Markdown>,
    );
    expect(html).toContain('href="https://electron-vite.org/guide/"');
    expect(html).toContain(">Guide</a>");
  });

  it("keeps the anchor when the link text is wrapped in backticks", () => {
    // Agent 常见写法：链接文字用反引号包住，视觉上会退化成代码框
    const html = renderToStaticMarkup(
      <Markdown>{"看 [ `Getting Started` ](https://electron-vite.org/guide/)"}</Markdown>,
    );
    expect(html).toContain('href="https://electron-vite.org/guide/"');
    // 链接内的 code 由 CSS 还原成链接外观；这里确保 DOM 仍是 a > code
    expect(html).toMatch(/<a[^>]*>[\s\S]*<code[\s\S]*<\/code>[\s\S]*<\/a>/);
  });
});
