import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 聊天滚动容器的行为契约。
 *
 * 这里钉的是一条**用实测数据换来的**教训：
 * 底部留白必须用 `padding`（真实可滚动空间），**不能**用 `scroll-padding`。
 *
 * `scroll-padding` 定义滚动口的「最佳可视区」，会被所有 scroll-into-view 类
 * 操作采用。一旦设成 42vh，即使目标元素**本就在视野内**，一次
 * `scrollIntoView({ block: "nearest" })` 也会多滚一次 42vh。
 *
 * 拖选文本时浏览器会对选区终点持续做这类 reveal，于是每移动一次鼠标就多滚
 * 42vh —— 表现为「选中时视图飞快下滑、选区失控」。实测数据（容器高 520px，
 * 目标 top=321 已在视野内）：
 *
 * | | 滚动位移 | 目标下方空隙 |
 * | --- | --- | --- |
 * | `scroll-padding-bottom: 42vh` | **301px** | 454px |
 * | 去掉 | **0px** | 153px |
 */
const CHAT_CSS = readFileSync(
  fileURLToPath(new URL("../../styles/chat.css", import.meta.url)),
  "utf8",
);

const TOKENS_CSS = readFileSync(
  fileURLToPath(new URL("../../styles/tokens.css", import.meta.url)),
  "utf8",
);

/** 剥掉注释，避免解释性注释里提到的属性名被负向断言误伤。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const CHAT_CSS_RAW = CHAT_CSS;
const CHAT_CSS_CODE = stripComments(CHAT_CSS);

/** 抽出某个选择器的规则体，便于做作用域内的断言。 */
function ruleBody(selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  return CHAT_CSS_CODE.match(pattern)?.[1] ?? "";
}

describe("chat scroll container contract", () => {
  it("does not put the bottom cushion on scroll-padding", () => {
    const scrollContainer = ruleBody(".message-list");
    expect(scrollContainer, ".message-list").not.toBe("");
    // 这条是「选中时视图飞快下滑」的根因，绝不能再加回来
    expect(scrollContainer).not.toContain("scroll-padding");
    expect(scrollContainer).not.toContain("--message-scroll-cushion");
  });

  it("provides the bottom cushion as real padding on the content", () => {
    const inner = ruleBody(".message-list-inner");
    expect(inner).toContain("--message-scroll-cushion");
    expect(inner).toMatch(/padding:[^;]*var\(--message-scroll-cushion\)/);
  });

  it("keeps the composer-overlay variant on padding, not scroll-padding", () => {
    const overlay = ruleBody(".message-list.has-composer-overlay .message-list-inner");
    expect(overlay).toMatch(/padding-bottom:[^;]*var\(--message-scroll-cushion\)/);
    expect(overlay).not.toContain("scroll-padding");
  });

  it("keeps the cushion token in the design system", () => {
    expect(TOKENS_CSS).toMatch(/--message-scroll-cushion:\s*\d+vh/);
  });

  it("has no other scroll-padding usage that could distort selection", () => {
    // 去掉注释看：整个 chat.css 都不该出现 scroll-padding
    expect(CHAT_CSS_CODE).not.toContain("scroll-padding");
    // 但注释里要保留这条教训的说明
    expect(CHAT_CSS_RAW).toContain("scroll-padding");
  });
});
