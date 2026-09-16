import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

const DIAGRAM = `\`\`\`text
Renderer (React UI)
   ↕ IPC
Main Process
   └─ CodexAgentSession          apps/desktop/src/main/codex-agent-session.ts
\`\`\``;

describe("Markdown render output", () => {
  it("keeps newline characters in rendered pre/code html", () => {
    const html = renderToStaticMarkup(<Markdown>{DIAGRAM}</Markdown>);
    expect(html).toContain("↕ IPC");
    expect(html).toMatch(/↕ IPC[\s\S]*Main Process/);
    expect(html.match(/\n/g)?.length ?? 0).toBeGreaterThan(2);
  });

  it("routes unlabeled fences through the plain multiline renderer", () => {
    const html = renderToStaticMarkup(
      <Markdown>{"```\nRenderer (React UI)\n   ↕ IPC\nMain Process\n```"}</Markdown>,
    );
    expect(html).toContain("markdown-code-block");
    expect(html).toContain("Main Process");
  });

  it("keeps body text outside a closed plain code fence", () => {
    const html = renderToStaticMarkup(
      <Markdown>
        {"```\nRenderer (React UI)\n```\n\n**关键点**: Adapter 是单例\n\n## 传输层\n"}
      </Markdown>,
    );
    expect(html).toContain("Renderer (React UI)");
    expect(html).toContain("关键点");
    expect(html).toContain("传输层");
    const codeBlockEnd = html.indexOf("</code></pre></div>");
    const bodyStart = html.indexOf("关键点");
    expect(codeBlockEnd).toBeGreaterThan(-1);
    expect(bodyStart).toBeGreaterThan(codeBlockEnd);
  });

  it("renders shiki line spans as block lines when a language tag is present", () => {
    const html = renderToStaticMarkup(
      <Markdown>{"```ts\nconst a = 1\nconst b = 2\n```"}</Markdown>,
    );
    expect(html).toContain('data-streamdown="code-block-body"');
    expect(html).toContain("const a = 1");
    expect(html).toContain("const b = 2");
  });

  it("routes a type=renderer fence to the inline renderer, not to a code block", () => {
    const html = renderToStaticMarkup(
      <Markdown>{'```html type="renderer"\n<svg><circle r="4"/></svg>\n```'}</Markdown>,
    );
    expect(html).toContain("inline-render");
    // 关键：不能再落到代码块渲染路径上
    expect(html).not.toContain("code-block-body");
  });

  it("keeps an ordinary html fence as a highlighted code block", () => {
    // 这是本方案的核心保证：只有哨兵语言会走内联渲染，
    // 普通 html 代码示例必须保持原有的语法高亮与容器。
    const html = renderToStaticMarkup(
      <Markdown>{"```html\n<div>示例</div>\n```"}</Markdown>,
    );
    expect(html).toContain("code-block-body");
    expect(html).not.toContain("inline-render");
  });

  it("shows a placeholder instead of half-written markup while streaming", () => {
    // 流式期间 HTML 不完整，直接渲染会崩，必须走占位
    const html = renderToStaticMarkup(
      <Markdown streaming>
        {'```html type="renderer"\n<svg><circle r='}
      </Markdown>,
    );
    expect(html).toContain("inline-render");
    expect(html).toContain("图表生成中");
  });
});
