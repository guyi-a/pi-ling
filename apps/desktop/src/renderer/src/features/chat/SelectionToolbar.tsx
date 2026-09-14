import { MessageSquarePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { useComposerContextStore } from "./composer-context-store";
import { collectSelectionExcerpt } from "./selection-excerpt";
import {
  chatSource,
  capSnippetText,
  placeToolbar,
  shouldOfferAddToChat,
} from "./selection-context";

/** 选区落在这些区域里时不弹按钮：那是用户在自己编辑 prompt。 */
const EXCLUDED_SELECTOR = ".composer, .composer-wrap, textarea, input, [role='menu']";

interface PendingSelection {
  text: string;
  anchor: { left: number; top: number; right: number; bottom: number };
}

/**
 * 在对话记录里选中文本时浮出的「加入对话」按钮。
 *
 * 三个必须踩对的点（都会让功能静默失效）：
 *
 * 1. **按下按钮时不能清掉选区** —— click 默认会把焦点移到按钮上，
 *    `window.getSelection()` 随之变空。用 `onMouseDown` preventDefault 挡住。
 * 2. **必须提前抓取文本** —— 流式输出时 `use-message-presentation` 会逐块揭示，
 *    DOM 一变底下的选区就可能失效。所以在 mouseup 那一刻就把文本存下来，
 *    而不是等用户点按钮时再读。
 * 3. **滚动要让位置失效** —— 按钮是 fixed 定位，滚动后与选区对不上，直接收起来。
 */
export function SelectionToolbar(props: {
  /** 只在这个容器内响应选区（传对话记录区，不含输入框）。 */
  containerRef: RefObject<HTMLElement | null>;
  /** 引用片段按会话隔离。 */
  sessionId: string;
  /** 加入后把焦点交还给输入框，方便直接打字。 */
  onAdded?: () => void;
}) {
  const addSnippet = useComposerContextStore((state) => state.add);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // 记录最新一次有效选区；流式重渲染把选区冲掉后仍然可以用它
  const pendingRef = useRef<PendingSelection | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    const container = props.containerRef.current;
    if (!container) return;

    const capture = () => {
      const selection = window.getSelection();
      if (!selection) return;
      const text = selection.toString();
      const collapsed = selection.isCollapsed || selection.rangeCount === 0;
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;

      const insideContainer =
        (anchorNode !== null && container.contains(anchorNode)) ||
        (focusNode !== null && container.contains(focusNode));
      const insideExcluded =
        (anchorNode instanceof Element &&
          anchorNode.closest(EXCLUDED_SELECTOR) !== null) ||
        (focusNode instanceof Element &&
          focusNode.closest(EXCLUDED_SELECTOR) !== null);

      if (
        !insideContainer ||
        !shouldOfferAddToChat({
          text,
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
      const rect = rects.length > 0 ? rects[rects.length - 1]! : range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPending(null);
        return;
      }

      setPending({
        // 用 collectSelectionExcerpt 而不是 selection.toString()：
        // 后者会丢掉列表序号（CSS ::marker 不在 DOM 里），
        // 对「1. 2. 3.」这类步骤清单会丢失顺序语义
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
      // 让浏览器先把选区定下来
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
      if (target instanceof Node && buttonRef.current?.contains(target)) return;
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
  }, [props.containerRef]);

  // 位置依赖按钮实际尺寸，等渲染后再算
  useEffect(() => {
    if (!pending) {
      setPosition(null);
      return;
    }
    const button = buttonRef.current;
    const rect = button?.getBoundingClientRect();
    setPosition(
      placeToolbar({
        anchor: pending.anchor,
        toolbar: { width: rect?.width ?? 110, height: rect?.height ?? 30 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [pending]);

  if (!pending || !position) return null;

  return (
    <button
      type="button"
      ref={buttonRef}
      className="selection-add-to-chat"
      style={{ left: position.left, top: position.top }}
      // 关键：不让 click 抢走焦点，否则 window.getSelection() 会变空
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        // 用提前抓好的文本，而不是此刻再读选区
        const captured = pendingRef.current;
        if (!captured) return;
        const capped = capSnippetText(captured.text);
        addSnippet(props.sessionId, {
          text: capped.text,
          source: chatSource(),
        });
        window.getSelection()?.removeAllRanges();
        setPending(null);
        props.onAdded?.();
      }}
    >
      <MessageSquarePlus size={13} />
      加入对话
    </button>
  );
}
