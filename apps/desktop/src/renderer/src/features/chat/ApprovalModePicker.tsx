import type { ApprovalMode } from "@pi-ling/contracts";
import {
  Check,
  ChevronDown,
  FileCheck,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

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
  onChange: (mode: ApprovalMode) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const selected = modes.find((mode) => mode.value === props.value) ?? modes[0]!;
  const SelectedIcon = selected.icon;

  return (
    <details
      className="approval-mode"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        aria-label="审批模式"
        aria-disabled={props.disabled}
        onClick={(event) => {
          if (props.disabled) event.preventDefault();
        }}
      >
        <SelectedIcon />
        {selected.label}
        <ChevronDown className="approval-mode-chevron" />
      </summary>
      <div className="approval-mode-menu">
        {modes.map((mode) => {
          const Icon = mode.icon;
          return (
            <button
              type="button"
              className={mode.value === props.value ? "selected" : ""}
              disabled={props.disabled}
              key={mode.value}
              onClick={() => {
                setOpen(false);
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
      </div>
    </details>
  );
}
