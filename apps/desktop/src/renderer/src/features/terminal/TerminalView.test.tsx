import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TerminalEmptyState } from "./TerminalEmptyState";

describe("TerminalView", () => {
  it("renders the empty-state placeholder copy", () => {
    const html = renderToStaticMarkup(<TerminalEmptyState />);
    expect(html).toContain("Terminal");
    expect(html).toContain("选择工作区后，终端将在此打开。");
  });
});
