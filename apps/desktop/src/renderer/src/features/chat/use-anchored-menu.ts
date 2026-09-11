import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type AnchoredMenuPosition = {
  left: number;
  bottom: number;
};

export function useAnchoredMenu(open: boolean, onClose: () => void) {
  const [position, setPosition] = useState<AnchoredMenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) {
      setPosition(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setPosition({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 8,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const targetNode = event.target;
      if (!(targetNode instanceof Node)) return;
      if (rootRef.current?.contains(targetNode)) return;
      if (menuRef.current?.contains(targetNode)) return;
      onClose();
    };
    const onLayoutChange = () => {
      updatePosition();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onLayoutChange);
    window.addEventListener("scroll", onLayoutChange, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, true);
    };
  }, [open, onClose]);

  return {
    position,
    rootRef,
    triggerRef,
    menuRef,
  };
}
