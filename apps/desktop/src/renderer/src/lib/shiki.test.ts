import { describe, expect, it } from "vitest";

import { highlightCode, resolveLanguage } from "./shiki";

describe("shiki", () => {
  it("highlights typescript with inline colors", async () => {
    const html = await highlightCode(
      'const value: number = 1;\nexport function main() {}',
      resolveLanguage("sample.test.ts"),
      { showLineNumbers: true, dark: false },
    );
    expect(html).toContain('class="shiki');
    expect(html).toContain("color:#");
    expect(html).toContain("shiki-line-no");
  });
});
