import type { ApprovalMode } from "@pi-ling/contracts";
import {
  Check,
  ChevronDown,
  FileCheck,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";

import { useAnchoredMenu } from "./use-anchored-menu.js";

const modes: Array<{
  value: ApprovalMode;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "manual",
    label: "手动确认",
    description: "写文件和执行命令前询问",
    icon: ShieldCheck,
  },
  {
    value: "accept-write",
    label: "接受编辑",
    description: "工作区内文件改动自动允许",
    icon: FileCheck,
  },
  {
    value: "auto",
    label: "自动执行",
    description: "普通操作自动允许，危险操作仍询问",
    icon: Zap,
  },
];

export function ApprovalModePicker(props: {
  value: ApprovalMode;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (mode: ApprovalMode) => Promise<void>;
}) {
  const selected = modes.find((mode) => mode.value === props.value) ?? modes[0]!;
  const SelectedIcon = selected.icon;
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
            className="composer-menu composer-menu-portal approval-mode-menu"
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
                    <small>{mode.description}</small>
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
        className={`approval-mode${props.open ? " is-open" : ""}`}
      >
        <button
          ref={triggerRef}
          type="button"
          className="approval-mode-trigger"
          aria-label="审批模式"
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
          <ChevronDown className="approval-mode-chevron" />
        </button>
      </div>
      {menu}
    </>
  );
}
