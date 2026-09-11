import type { ComposerMode, RuntimeKind } from "@pi-ling/contracts";
import {
  Bot,
  Check,
  ChevronDown,
  ClipboardList,
  MessageCircleQuestion,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";

import { useAnchoredMenu } from "./use-anchored-menu.js";

const modes: Array<{
  value: ComposerMode;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "plan",
    label: "Plan",
    description: "先出方案，等 Build 再执行",
    icon: ClipboardList,
  },
  {
    value: "ask",
    label: "Ask",
    description: "只读探索与问答",
    icon: MessageCircleQuestion,
  },
  {
    value: "agent",
    label: "Agent",
    description: "直接改代码并执行",
    icon: Bot,
  },
];

export function ComposerModePicker(props: {
  value: ComposerMode;
  runtimeKind: RuntimeKind;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (mode: ComposerMode) => Promise<void>;
}) {
  const selected = modes.find((mode) => mode.value === props.value) ?? modes[2]!;
  const SelectedIcon = selected.icon;
  const dshHint = props.runtimeKind === "dsh";
  const codexHint = props.runtimeKind === "codex";
  const close = () => props.onOpenChange(false);
  const { position, rootRef, triggerRef, menuRef } = useAnchoredMenu(
    props.open,
    close,
  );

  const menu =
    props.open && position
      ? createPortal(
          <div
            ref={menuRef}
            className="composer-menu composer-menu-portal composer-mode-menu"
            role="menu"
            style={{
              left: `${position.left}px`,
              bottom: `${position.bottom}px`,
            }}
          >
            {modes.map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  type="button"
                  className={mode.value === props.value ? "selected" : ""}
                  disabled={props.disabled}
                  key={mode.value}
                  onClick={() => {
                    close();
                    if (mode.value !== props.value) {
                      void props.onChange(mode.value);
                    }
                  }}
                >
                  <Icon />
                  <span>
                    <strong>{mode.label}</strong>
                    <small>
                      {mode.description}
                      {dshHint && mode.value !== "agent"
                        ? " · DSH 为提示引导"
                        : ""}
                      {codexHint && mode.value === "plan"
                        ? " · Codex Plan 模式"
                        : ""}
                    </small>
                  </span>
                  {mode.value === props.value ? <Check /> : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        ref={rootRef}
        className={`composer-mode${props.open ? " is-open" : ""}`}
      >
        <button
          ref={triggerRef}
          type="button"
          className="composer-mode-trigger"
          aria-label="Composer 模式"
          aria-haspopup="menu"
          aria-expanded={props.open}
          disabled={props.disabled}
          onClick={() => {
            if (!props.disabled) {
              props.onOpenChange(!props.open);
            }
          }}
        >
          <SelectedIcon />
          {selected.label}
          <ChevronDown className="composer-mode-chevron" />
        </button>
      </div>
      {menu}
    </>
  );
}
