import { useEffect, useRef, useState } from "react";

import { AddToChatButton } from "./AddToChatButton";
import { useComposerContextStore } from "./composer-context-store";
import { collectSelectionExcerpt } from "./selection-excerpt";
import {
  capSnippetText,
  shouldOfferAddToChat,
  type ContextSource,
  type Rect,
} from "./selection-context";

/**
 * 选区落在这些区域里时不弹按钮。
 *
 * 除了输入框/菜单（那是用户在自己操作表单），还包括代码编辑器 —— 它用的是
 * CodeMirror 自己的选区模型，由 `CodeEditor.onSelectionChange` 单独上报。
 * 不排除的话，编辑器里选中文本会让两个按钮同时冒出来。
 */
const EXCLUDED_SELECTOR =
  ".composer, .composer-wrap, textarea, input, [role='menu'], .files-editor-host, .cm-editor";

interface PendingSelection {
  text: string;
  anchor: Rect;
}

/**
 * 基于 DOM Selection 的「加入对话」按钮。
 *
 * 三处都能用：对话记录、Files 面板的 Markdown 预览。编辑器（CodeMirror）
 * 用的是自己的选区模型，不走这里，见 `FilePreview` 里的编辑器分支。
 *
 * 必须踩对的点（都会让功能静默失效）：
 *
 * 1. **按下按钮时不能清掉选区** —— 交给 `AddToChatButton` 的 preventDefault。
 * 2. **必须提前抓取文本** —— 回答在流式输出时会被逐块重渲染，DOM 一变选区就
 *    可能失效。所以在 mouseup 那一刻就把文本存下来，而不是等点按钮时再读。
 * 3. **滚动要让位置失效** —— 按钮是 fixed 定位，滚动后与选区对不上，直接收起。
 */
export function SelectionToolbar(props: {
  /**
   * 只在这个容器内响应选区（不含输入框等排除区）。
   *
   * 这里收**元素本身**而不是 `RefObject`：ref 的 `.current` 在 effect 首次执行时
   * 可能仍是 null，而依赖数组里放 ref 对象不会触发重跑，监听就永远绑不上
   * （实测在 Files 面板踩过 —— 组件挂载了但按钮从不出现）。
   * 由调用方用回调 ref 存进 state，元素就绪后本组件会重跑 effect。
   */
  container: HTMLElement | null;
  /** 引用片段按会话隔离。 */
  sessionId: string;
  /**
   * 引用来源。给函数则每次捕获时求值 —— Files 面板需要按当前文件动态算标签。
   */
  source: ContextSource | (() => ContextSource);
  /** 加入后把焦点交还（对话页用来回到输入框）。 */
  onAdded?: () => void;
}) {
  const addSnippet = useComposerContextStore((state) => state.add);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const buttonHostRef = useRef<HTMLDivElement | null>(null);

  const pendingRef = useRef<PendingSelection | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    const container = props.container;
    if (!container) return;

    const capture = () => {
      const selection = window.getSelection();
      if (!selection) return;
      const collapsed = selection.isCollapsed || selection.rangeCount === 0;
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;

      const closest = (node: Node | null) =>
        node instanceof Element ? node : (node?.parentElement ?? null);

      const insideContainer =
        (anchorNode !== null && container.contains(anchorNode)) ||
        (focusNode !== null && container.contains(focusNode));
      const insideExcluded =
        closest(anchorNode)?.closest(EXCLUDED_SELECTOR) !== null ||
        closest(focusNode)?.closest(EXCLUDED_SELECTOR) !== null;
      // 按钮自身所在区域的选区不算（点了按钮之后浏览器可能保留标记）
      const insideToolbar =
        (anchorNode !== null &&
          buttonHostRef.current?.contains(anchorNode)) ||
        (focusNode !== null && buttonHostRef.current?.contains(focusNode));

      // 提前取出纯文本用于判断；真正要引用的正文在下面用摘录序列化重算
      const probeText = selection.toString();

      if (
        !insideContainer ||
        insideExcluded ||
        insideToolbar ||
        !shouldOfferAddToChat({
          text: probeText,
          isCollapsed: collapsed,
          isInsideExcluded: insideExcluded,
        })
      ) {
        setPending(null);
        return;
      }

      // 用**最后一个** rect：那是用户拖选结束的位置，按钮贴着它最自然
      const range = selection.getRangeAt(0);
      const rects = range.getClientRects();
      const rect =
        rects.length > 0
          ? rects[rects.length - 1]!
          : range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPending(null);
        return;
      }

      setPending({
        // 用 collectSelectionExcerpt 而不是 toString()：后者会丢掉列表序号
        // （CSS ::marker 不在 DOM 里），对「1. 2. 3.」这类步骤清单会丢失顺序语义
        text: collectSelectionExcerpt(range),
        anchor: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
      });
    };

    // mouseup 覆盖鼠标拖选；keyup 覆盖 Shift+方向键的键盘选择
    const onMouseUp = () => {
      window.requestAnimationFrame(capture);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key.startsWith("Arrow")) capture();
    };
    /**
     * 在别处按下鼠标就把按钮收起来。
     *
     * **必须排除按钮自身**：事件会从按钮冒泡到容器，若不排除，按下的瞬间
     * `pending` 就被清空、按钮在 `click` 触发前卸载 —— 表现为「点了没反应」。
     * （实测踩过；纯函数测试覆盖不到，只有真交互能发现。）
     */
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && buttonHostRef.current?.contains(target)) {
        return;
      }
      setPending(null);
    };
    const onScroll = () => setPending(null);

    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("keyup", onKeyUp);
    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("scroll", onScroll, true);
    return () => {
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("keyup", onKeyUp);
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("scroll", onScroll, true);
    };
  }, [props.container]);

  /*
   * 宿主**始终渲染**，只在其内部按需显示按钮。
   *
   * 两个原因：`buttonHostRef` 需要稳定存在（用于判断「mousedown 是否落在按钮上」），
   * 以及组件是否挂载可以从 DOM 直接观测到 —— 之前返回 null 时完全无从判断
   * 监听有没有绑上。
   */
  return (
    <div ref={buttonHostRef} className="add-to-chat-host">
      {pending ? (
        <AddToChatButton
          anchor={pending.anchor}
          title={pending.text.slice(0, 200)}
          onAdd={() => {
            // 用提前抓好的文本，而不是此刻再读选区
            const captured = pendingRef.current;
            if (!captured) return;
            const capped = capSnippetText(captured.text);
            addSnippet(props.sessionId, {
              text: capped.text,
              source:
                typeof props.source === "function" ? props.source() : props.source,
            });
            window.getSelection()?.removeAllRanges();
            setPending(null);
            props.onAdded?.();
          }}
        />
      ) : null}
    </div>
  );
}
