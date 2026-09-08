import type { RuntimeKind } from "@pi-ling/contracts";
import { Bot, ChevronDown, FlaskConical, LoaderCircle } from "lucide-react";
import { useState } from "react";

export function RuntimePicker(props: {
  value: RuntimeKind;
  available: RuntimeKind[];
  disabled: boolean;
  switching?: boolean;
  switchingTo?: RuntimeKind | null;
  onChange: (runtime: RuntimeKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const busy = Boolean(props.switching);
  const target = props.switchingTo ?? props.value;
  const label =
    busy
      ? target === "dsh"
        ? "切换 DSH…"
        : "切换 Native…"
      : props.value === "dsh"
        ? "DSH"
        : "Native";
  return (
    <details
      className={`runtime-picker${busy ? " is-switching" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        aria-label="Runtime"
        aria-busy={busy}
        onClick={(event) => {
          if (props.disabled || busy) event.preventDefault();
        }}
      >
        {busy ? (
          <LoaderCircle className="runtime-switch-spinner" />
        ) : target === "dsh" ? (
          <FlaskConical />
        ) : (
          <Bot />
        )}
        {label}
        <ChevronDown />
      </summary>
      <div className="runtime-menu">
        <button
          type="button"
          className={props.value === "native" ? "selected" : ""}
          disabled={busy}
          onClick={() => {
            setOpen(false);
            props.onChange("native");
          }}
        >
          <Bot />
          <span>
            <strong>Native</strong>
            <small>pi-ling Coding Agent</small>
          </span>
        </button>
        <button
          type="button"
          disabled={busy || !props.available.includes("dsh")}
          className={props.value === "dsh" ? "selected" : ""}
          onClick={() => {
            setOpen(false);
            props.onChange("dsh");
          }}
        >
          <FlaskConical />
          <span>
            <strong>DeepSeek Harness</strong>
            <small>Experimental · ACP</small>
          </span>
        </button>
      </div>
    </details>
  );
}
