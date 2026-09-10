import type { ComposerMode, RuntimeKind } from "@pi-ling/contracts";
import {
  Bot,
  Check,
  ChevronDown,
  ClipboardList,
  MessageCircleQuestion,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

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
  onChange: (mode: ComposerMode) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const selected = modes.find((mode) => mode.value === props.value) ?? modes[2]!;
  const SelectedIcon = selected.icon;
  const dshHint = props.runtimeKind === "dsh";

  return (
    <details
      className="composer-mode"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        aria-label="Composer 模式"
        aria-disabled={props.disabled}
        onClick={(event) => {
          if (props.disabled) event.preventDefault();
        }}
      >
        <SelectedIcon />
        {selected.label}
        <ChevronDown className="composer-mode-chevron" />
      </summary>
      <div className="composer-mode-menu">
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
                <small>
                  {mode.description}
                  {dshHint && mode.value !== "agent"
                    ? " · DSH 为提示引导"
                    : ""}
                </small>
              </span>
              {mode.value === props.value ? <Check /> : null}
            </button>
          );
        })}
      </div>
    </details>
  );
}
