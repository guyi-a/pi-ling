import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

const PY = "import sys\nfrom collections import deque\n\ndef main():\n    print(1)";

describe("code block rendering", () => {
  it("routes an unlabeled python fence to the streamdown code block", () => {
    const html = renderToStaticMarkup(<Markdown>{`\`\`\`\n${PY}\n\`\`\``}</Markdown>);
    expect(html).toContain('data-streamdown="code-block-body"');
    expect(html).toContain('data-language="python"');
  });

  it("keeps each source line in its own top-level span", () => {
    // Shiki 不在行间输出换行符，断行靠 CSS；
    // 这里锁住「每行一个顶层 span」这个契约，CSS 才有的放矢。
    const html = renderToStaticMarkup(<Markdown>{`\`\`\`\n${PY}\n\`\`\``}</Markdown>);
    const match = /<code>([\s\S]*?)<\/code>/.exec(html);
    expect(match).not.toBeNull();
    const inner = match![1]!;
    // 顶层 span 数量 = 代码行数（5 行，含一个空行）
    const topLevelSpans = inner.match(/<span>(?=<span|[\s\S]*?<\/span><\/span>)/g) ?? [];
    expect(topLevelSpans.length).toBeGreaterThanOrEqual(4);
  });

  it("still uses the plain renderer for diagrams so structure survives", () => {
    const diagram = "Renderer (React UI)\n   ↕ IPC\nMain Process";
    const html = renderToStaticMarkup(<Markdown>{`\`\`\`\n${diagram}\n\`\`\``}</Markdown>);
    expect(html).toContain("markdown-code-block");
    expect(html).not.toContain('data-streamdown="code-block-body"');
    // 纯文本路径保留真实换行
    expect(html).toMatch(/Renderer \(React UI\)\n/);
  });

  it("still uses the plain renderer for undetectable content", () => {
    const html = renderToStaticMarkup(
      <Markdown>{"```\n这是一段普通说明文字\n第二行\n```"}</Markdown>,
    );
    expect(html).toContain("markdown-code-block");
    expect(html).not.toContain('data-streamdown="code-block-body"');
  });

  it("sends an explicitly labeled shell fence to the highlighter", () => {
    const html = renderToStaticMarkup(
      <Markdown>{"```bash\npnpm install\npnpm build\n```"}</Markdown>,
    );
    expect(html).toContain('data-streamdown="code-block-body"');
    expect(html).toContain('data-language="bash"');
  });

  it("keeps an explicit text fence on the plain renderer", () => {
    const html = renderToStaticMarkup(
      <Markdown>{"```text\na\nb\n```"}</Markdown>,
    );
    expect(html).toContain("markdown-code-block");
  });
});
