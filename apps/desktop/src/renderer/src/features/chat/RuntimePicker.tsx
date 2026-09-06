import type { RuntimeKind } from "@pi-ling/contracts";
import { Bot, ChevronDown, FlaskConical } from "lucide-react";
import { useState } from "react";

export function RuntimePicker(props: {
  value: RuntimeKind;
  available: RuntimeKind[];
  disabled: boolean;
  onChange: (runtime: RuntimeKind) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="runtime-picker"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        aria-label="Runtime"
        onClick={(event) => {
          if (props.disabled) event.preventDefault();
        }}
      >
        {props.value === "dsh" ? <FlaskConical /> : <Bot />}
        {props.value === "dsh" ? "DSH" : "Native"}
        <ChevronDown />
      </summary>
      <div className="runtime-menu">
        <button
          type="button"
          className={props.value === "native" ? "selected" : ""}
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
          disabled={!props.available.includes("dsh")}
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
