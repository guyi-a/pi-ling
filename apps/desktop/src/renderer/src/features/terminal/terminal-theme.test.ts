import { describe, expect, it } from "vitest";

import { createTerminalTheme, TERMINAL_THEME } from "./terminal-theme";

describe("terminal theme", () => {
  it("is fixed dark so it matches the hardcoded dark terminal chrome", () => {
    // 这些值取自深色主题的 CSS 变量；终端外壳（terminal.css）同样是写死的深色，
    // 两者必须保持同一套，否则浅色模式下会出现浅底深字嵌在深色边框里。
    expect(TERMINAL_THEME.background).toBe("#171717");
    expect(TERMINAL_THEME.foreground).toBe("#dedede");
    expect(TERMINAL_THEME.red).toBe("#f5927e");
  });

  it("does not derive colors from theme CSS variables", () => {
    // 回归防护：过去这里读 getComputedStyle 的 --code-bg 等变量，
    // 浅色主题下会得到浅色调色板。终端必须是固定深色。
    for (const value of Object.values(TERMINAL_THEME)) {
      expect(value).not.toMatch(/var\(|--/);
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("hands xterm a fresh object each time", () => {
    const first = createTerminalTheme();
    const second = createTerminalTheme();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
