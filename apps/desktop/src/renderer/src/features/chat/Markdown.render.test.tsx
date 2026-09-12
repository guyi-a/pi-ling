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
});
