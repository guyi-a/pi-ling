import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

describe("Markdown math rendering", () => {
  it("renders single-dollar inline math as KaTeX markup", () => {
    const html = renderToStaticMarkup(
      <Markdown>{"接缝数 $S=\\sum_{i=1}^{n-1} a_i$ 的变化量"}</Markdown>,
    );
    // KaTeX 输出的公式结构，而不是原样的 $...$
    expect(html).toContain("katex");
    expect(html).not.toContain("$S=");
  });

  it("renders double-dollar block math", () => {
    const html = renderToStaticMarkup(
      <Markdown>{"$$\\Delta = -[a_{l-1} \\ne a_l]$$"}</Markdown>,
    );
    expect(html).toContain("katex");
  });

  it("leaves escaped dollars as literal text", () => {
    // 模型有时会写成 \$l,r\$ —— 这是转义的字面美元符，不应被当作公式
    const html = renderToStaticMarkup(<Markdown>{"区间 \\$l,r\\$ 是闭区间"}</Markdown>);
    expect(html).not.toContain("katex");
    expect(html).toContain("$l,r$");
  });

  it("documents the known tradeoff: adjacent dollar amounts read as math", () => {
    // 开启 singleDollarTextMath 的代价：像 "$5 到 $10" 这样的文本会被
    // 当成行内公式。GitHub 正因如此默认不开单美元。
    // 对编码助手来说公式是高频场景、金额是低频场景，因此接受这个代价。
    const html = renderToStaticMarkup(<Markdown>{"价格是 $5 到 $10"}</Markdown>);
    expect(html).toContain("katex");
  });
});
