import { MessageSquarePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { placeToolbar, type Rect } from "./selection-context";

/**
 * 「加入对话」浮动按钮。
 *
 * 只负责摆放与点击，选区检测交给调用方 —— 对话记录与 Files 编辑器的选区
 * 来自完全不同的机制（DOM Selection vs CodeMirror 状态），但按钮长得一样、
 * 摆放规则也一样，所以共享这一个组件。
 *
 * 两个必须踩对的细节：
 * 1. `onMouseDown` 要 preventDefault —— 否则 click 会把焦点移到按钮上，
 *    调用方那边的选区会立刻失效（DOM 场景尤其明显）。
 * 2. 位置依赖按钮实际尺寸，所以先按估算值渲染一帧，量到真实尺寸后再校正。
 */
export function AddToChatButton(props: {
  anchor: Rect;
  /** 悬浮提示，用来预览将被引用的内容。 */
  title?: string;
  onAdd: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

  useEffect(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    setPosition(
      placeToolbar({
        anchor: props.anchor,
        toolbar: { width: rect?.width ?? 110, height: rect?.height ?? 30 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [props.anchor]);

  // 首帧只是用来量尺寸，先隐藏避免闪烁
  const measuring = position === null;
  const style = measuring
    ? { left: props.anchor.left, top: props.anchor.top, visibility: "hidden" as const }
    : { left: position.left, top: position.top };

  return (
    <button
      type="button"
      ref={buttonRef}
      className="selection-add-to-chat"
      style={style}
      title={props.title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onAdd}
    >
      <MessageSquarePlus size={13} />
      加入对话
    </button>
  );
}
