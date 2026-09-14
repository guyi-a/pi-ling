import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 「加入对话」在对话记录与 Files 面板两处的接线契约。
 *
 * 这些不是样式或配色问题，而是**接线方式**上踩过的坑 —— 都会让功能静默失效，
 * 且单测测不到（组件挂载了、逻辑也对，只是监听从没绑上或按钮被提前卸载）。
 */
function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

const SELECTION_TOOLBAR = readSource("../chat/SelectionToolbar.tsx");
const CHAT_VIEW = readSource("../chat/ChatView.tsx");
const FILE_PREVIEW = readSource("../files/FilePreview.tsx");
const ADD_BUTTON = readSource("../chat/AddToChatButton.tsx");
const CODE_EDITOR = readSource("../files/CodeEditor.tsx");

describe("add-to-chat wiring contract", () => {
  it("hands the container to the toolbar as an element, not a ref", () => {
    // 踩过的坑：原本传 RefObject，在 effect 里读 `containerRef.current`，
    // 而 deps 放 ref 对象永远不会变 —— 首次执行时若 ref 还是 null，监听就
    // **永久绑不上**。表现为「对话页能用、Files 面板的按钮从不出现」。
    // 改为传元素本身 + 回调 ref 存 state，元素就绪后 effect 会重跑。
    expect(SELECTION_TOOLBAR).toContain("container: HTMLElement | null");
    expect(SELECTION_TOOLBAR).not.toContain("containerRef");
    // deps 必须是元素（会变化），不能是 ref 对象（永不变化）
    expect(SELECTION_TOOLBAR).toMatch(/\}, \[props\.container\]\)/);

    for (const [name, source] of [
      ["ChatView.tsx", CHAT_VIEW],
      ["FilePreview.tsx", FILE_PREVIEW],
    ] as const) {
      expect(source, name).toMatch(/container=\{[a-zA-Z]+\}/);
      expect(source, name).not.toMatch(/<SelectionToolbar[\s\S]{0,200}containerRef=/);
    }
  });

  it("stores the container element in state via a stable callback ref", () => {
    // useCallback 必须带空依赖，否则每次渲染都是新的 ref 回调 →
    // React 会先以 null 调用、再以节点调用，造成 state 抖动
    expect(CHAT_VIEW).toMatch(/attachMessageArea = useCallback\(\s*\(node[\s\S]{0,120}\[\]/);
    expect(FILE_PREVIEW).toMatch(/attachPreview = useCallback\(\s*\(node[\s\S]{0,120}\[\]/);
  });

  it("excludes the code editor from DOM-based selection detection", () => {
    // CodeMirror 有自己的选区模型，DOM 选区检测必须跳过它，
    // 否则编辑器里选文本会让两个按钮同时冒出来
    expect(SELECTION_TOOLBAR).toContain(".files-editor-host");
    expect(SELECTION_TOOLBAR).toContain(".cm-editor");
  });

  it("keeps the add-to-chat host always mounted", () => {
    // 宿主必须稳定存在：既用于判断「mousedown 是否落在按钮上」，
    // 也让「监听是否绑上」可以从 DOM 观测（整组件返回 null 时完全无从判断）
    expect(SELECTION_TOOLBAR).toMatch(
      /className="add-to-chat-host"[\s\S]{0,120}\{pending \?/,
    );
  });

  it("prevents the button from stealing focus", () => {
    // 不 preventDefault 的话 click 会把焦点移到按钮上，
    // DOM 选区随即失效 —— 引用内容会变成空
    expect(ADD_BUTTON).toMatch(
      /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/,
    );
  });

  it("keeps the editor path on CodeMirror's own selection model", () => {
    // 编辑器不能靠 DOM 选区：CodeMirror 有虚拟滚动，只有它自己知道
    // 文档位置对应屏幕上的哪个点
    expect(CODE_EDITOR).toContain("coordsAtPos");
    expect(CODE_EDITOR).toContain("onSelectionChange");
    expect(FILE_PREVIEW).toContain("onSelectionChange={setEditorSelection}");
    // 行号要带进来源标签，Agent 据此能重读最新内容
    expect(FILE_PREVIEW).toContain("formatFileSource");
  });
});
