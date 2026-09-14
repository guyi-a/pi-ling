import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 终端「加入对话」的接线契约。
 *
 * 终端是本产品里唯一**没有可选 DOM 文本**的视图（内容由 xterm 自己渲染），
 * 所以它的选区必须走 `terminal.getSelection()`，坐标必须由 xterm 的行列 API
 * 换算 —— 不能像对话页 / Markdown 预览那样依赖 `window.getSelection()`。
 */
function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  ).replace(/\r\n/g, "\n");
}

const INSTANCE = readSource("../terminal/TerminalInstance.tsx");
const PANEL = readSource("../terminal/TerminalPanel.tsx");
const WORKBENCH = readSource("../shell/WorkbenchChrome.tsx");
const APP = readSource("../../App.tsx");

describe("terminal add-to-chat wiring contract", () => {
  it("reads the selection from xterm, not the DOM", () => {
    expect(INSTANCE).toContain("terminal.getSelection()");
    expect(INSTANCE).toContain("terminal.getSelectionPosition()");
    expect(INSTANCE).toContain("onSelectionChange");
    // 终端的选区监听必须随组件卸载一起释放
    expect(INSTANCE).toContain("selectionDisposable.dispose()");
  });

  it("keeps the selection callback out of the mount effect deps", () => {
    // 回调若进 deps，父组件每次重渲染都会重建终端（历史、状态全丢）
    expect(INSTANCE).toMatch(/onSelectionChangeRef\.current = props\.onSelectionChange/);
    expect(INSTANCE).not.toMatch(/\}, \[props\.root, props\.active, props\.visible, props\.onSelectionChange\]/);
  });

  it("lets the user select text with a plain drag", () => {
    // 右键改成选词而不是粘贴；左键拖选 xterm 本身就支持
    expect(INSTANCE).toContain("rightClickSelectsWord: true");
  });

  it("only accepts selections from the visible terminal tab", () => {
    // 后台终端也可能持有选区，不隔离的话按钮会被不可见的终端抢走
    expect(PANEL).toMatch(/session\.id !== activeId\) return;/);
  });

  it("labels terminal quotes distinctly from chat and file quotes", () => {
    expect(PANEL).toContain("terminalSource()");
    const context = readSource("../chat/selection-context.ts");
    expect(context).toMatch(/terminalSource\(\): ContextSource \{\s*return \{ kind: "terminal"/);
  });

  it("threads the session id down so snippets stay scoped", () => {
    expect(WORKBENCH).toContain("terminalSessionId");
    expect(APP).toContain("terminalSessionId={timeline.sessionId ?? undefined}");
  });
});
