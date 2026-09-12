import type { WorkspaceTreeNode } from "@pi-ling/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type MenuPosition = {
  left: number;
  bottom: number;
};

export function ComposerFileMentionMenu(props: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  files: readonly WorkspaceTreeNode[];
  activeIndex: number;
  query: string;
  onSelect: (relativePath: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  useLayoutEffect(() => {
    if (!props.open) {
      setPosition(null);
      return;
    }
    const anchor = props.anchorRef.current;
    if (!anchor) {
      setPosition(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    setPosition({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 8,
    });
  }, [props.anchorRef, props.open, props.query, props.files.length]);

  useEffect(() => {
    if (!props.open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      if (props.anchorRef.current?.contains(target)) return;
      props.onClose();
    };
    const onLayoutChange = () => {
      const anchor = props.anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setPosition({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      });
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("scroll", onLayoutChange, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, true);
    };
  }, [props]);

  if (!props.open || !position) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="composer-mention-menu"
      style={{
        left: position.left,
        bottom: position.bottom,
      }}
      role="listbox"
      aria-label="引用工作区文件"
    >
      {props.files.length === 0 ? (
        <div className="composer-mention-empty">
          {props.query.trim() ? "没有匹配的文件" : "输入文件名过滤"}
        </div>
      ) : (
        props.files.map((file, index) => (
          <button
            key={file.path}
            type="button"
            className={`composer-mention-item${
              index === props.activeIndex ? " is-active" : ""
            }`}
            role="option"
            aria-selected={index === props.activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => props.onSelect(file.path)}
          >
            <span className="composer-mention-path">{file.path}</span>
            <span className="composer-mention-name">{file.name}</span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
