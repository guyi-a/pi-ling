import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 代码着色主题的**一致性契约**。
 *
 * 两处必须用同一套主题，否则同一个文件在聊天里和右侧预览里会长得不一样。
 * 另外，聊天侧的主题**只能在插件上配置**：Streamdown 内核的取值顺序是
 * `plugin.getThemes() ?? props.shikiTheme`，插件的值会覆盖 prop，
 * 传 `shikiTheme` 会被静默忽略（曾因此踩坑）。这里把这些约束钉住。
 */
const MARKDOWN_TSX = readFileSync(
  fileURLToPath(new URL("./Markdown.tsx", import.meta.url)),
  "utf8",
);
const SHIKI_TS = readFileSync(
  fileURLToPath(new URL("../../lib/shiki.ts", import.meta.url)),
  "utf8",
);

const DARK_THEME = "one-dark-pro";
const LIGHT_THEME = "one-light";

describe("code highlighting theme contract", () => {
  it("configures both themes on the streamdown code plugin", () => {
    expect(MARKDOWN_TSX).toMatch(/createCodePlugin\(\{/);
    expect(MARKDOWN_TSX).toContain(LIGHT_THEME);
    expect(MARKDOWN_TSX).toContain(DARK_THEME);
  });

  it("does not rely on the shikiTheme prop, which the plugin overrides", () => {
    expect(MARKDOWN_TSX).not.toMatch(/shikiTheme=\{/);
  });

  it("uses the same themes in the Files preview highlighter", () => {
    expect(SHIKI_TS).toContain(`"${LIGHT_THEME}"`);
    expect(SHIKI_TS).toContain(`"${DARK_THEME}"`);
    // 且不再引用旧的 github 主题
    expect(SHIKI_TS).not.toMatch(/themes\/github-(light|dark)/);
  });

  it("avoids red keywords so code does not compete with error styling", () => {
    // github-light/-dark 的关键字是红色，与失败卡片、报错提示的语义色冲突
    expect(MARKDOWN_TSX).not.toContain("github-light");
    expect(SHIKI_TS).not.toContain("github-light");
  });
});
