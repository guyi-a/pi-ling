import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./TerminalInstance", () => ({
  TerminalInstance: () => null,
}));

import { TerminalPanel } from "./TerminalPanel";

describe("TerminalPanel", () => {
  it("renders the default tab label and new-terminal control", () => {
    const html = renderToStaticMarkup(
      <TerminalPanel root="E:\\pi-ling" active />,
    );
    expect(html).toContain("Terminal 1");
    expect(html).toContain('aria-label="新建终端"');
    expect(html).toContain('aria-label="终端列表"');
    expect(html).toContain('aria-label="删除当前终端"');
  });
});
