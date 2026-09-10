import {
  Check,
  ChevronRight,
  CircleSlash,
  LoaderCircle,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  resolveToolLabel,
  resolveToolTarget,
} from "../../../run-activity/tool-registry";
import type { ToolTimelineItem } from "../../../timeline/reducer";

const statusLabel: Record<ToolTimelineItem["status"], string> = {
  requested: "Waiting",
  "awaiting-approval": "Approval",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  denied: "Denied",
  cancelled: "Not run",
};

export function ToolCardShell(props: {
  item: ToolTimelineItem;
  children?: ReactNode;
  defaultOpen?: boolean;
  keepCollapsed?: boolean;
  disableExpand?: boolean;
  hideRawDetails?: boolean;
  label?: string;
  target?: string;
  statusText?: string;
}) {
  const { item, children, defaultOpen = false, keepCollapsed = false } = props;
  const [open, setOpen] = useState(
    keepCollapsed
      ? false
      : defaultOpen || item.status === "failed",
  );
  const StateIcon =
    item.status === "running"
      ? LoaderCircle
      : item.status === "completed"
        ? Check
        : item.status === "failed" || item.status === "denied"
          ? X
          : item.status === "cancelled"
            ? CircleSlash
            : null;
  const label = props.label ?? resolveToolLabel(item);
  const target = props.target ?? resolveToolTarget(item);
  const statusText = props.statusText ?? statusLabel[item.status];
  const expandable =
    !props.disableExpand &&
    (Boolean(children) ||
      Object.keys(item.arguments).length > 0 ||
      Boolean(item.output));

  return (
    <div
      className={`tool-entry tool-rich-card ${item.status} ${
        open ? "expanded" : ""
      }`}
    >
      <button
        className="tool-entry-row"
        type="button"
        aria-expanded={open}
        disabled={!expandable}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight className="tool-entry-chevron" />
        {StateIcon ? (
          <StateIcon className="tool-entry-state-icon" />
        ) : (
          <span className="tool-entry-dot" />
        )}
        <span className="tool-entry-label">{label}</span>
        <span className="tool-entry-target" title={target}>
          {target}
        </span>
        <span className="tool-entry-state">{statusText}</span>
      </button>
      {open ? (
        <>
          {children ? <div className="tool-rich-body">{children}</div> : null}
          {!props.hideRawDetails &&
          (Object.keys(item.arguments).length > 0 || item.output) ? (
            <div className="tool-entry-details">
              {Object.keys(item.arguments).length > 0 ? (
                <section>
                  <span>Arguments</span>
                  <pre>{JSON.stringify(item.arguments, null, 2)}</pre>
                </section>
              ) : null}
              {item.output ? (
                <section>
                  <span>Output</span>
                  <pre>{item.output}</pre>
                </section>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function recordArg(
  arguments_: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = arguments_[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringListArg(
  arguments_: Record<string, unknown>,
  ...keys: string[]
): string[] {
  for (const key of keys) {
    const value = arguments_[key];
    if (!Array.isArray(value)) continue;
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (typeof entry === "object" && entry !== null) {
          const record = entry as Record<string, unknown>;
          const text =
            record["content"] ??
            record["text"] ??
            record["title"] ??
            record["id"];
          return typeof text === "string" ? text.trim() : "";
        }
        return "";
      })
      .filter(Boolean);
  }
  return [];
}
