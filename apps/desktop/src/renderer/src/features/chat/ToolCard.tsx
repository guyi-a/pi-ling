import {
  Check,
  ChevronRight,
  CircleSlash,
  LoaderCircle,
  X,
} from "lucide-react";
import { useState } from "react";

import {
  resolveToolCategory,
  resolveToolLabel,
  resolveToolRenderer,
  resolveToolTarget,
} from "../../run-activity/tool-registry";
import type { ToolTimelineItem } from "../../timeline/reducer";

const statusLabel: Record<ToolTimelineItem["status"], string> = {
  requested: "Waiting",
  "awaiting-approval": "Approval",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  denied: "Denied",
  cancelled: "Not run",
};

export function DefaultToolCard(props: { item: ToolTimelineItem }) {
  const { item } = props;
  // 一律默认折叠：失败会以红色 Failed 标在行尾，需要详情时再展开。
  const [open, setOpen] = useState(false);
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
  const target = resolveToolTarget(item);
  const category = resolveToolCategory(item);
  const ext = target.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  const failedLike = item.status === "failed" || item.status === "denied";
  const expandable =
    failedLike ||
    Object.keys(item.arguments).length > 0 ||
    Boolean(item.output);

  return (
    <div
      className={`tool-entry tool-cat-${category} ${item.status} ${open ? "expanded" : ""}`}
      data-ext={ext || undefined}
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
        <span className="tool-entry-label">{resolveToolLabel(item)}</span>
        <span className="tool-entry-target" title={target}>
          {target}
        </span>
        <span className="tool-entry-state">{statusLabel[item.status]}</span>
      </button>
      {open && expandable ? (
        <div className="tool-entry-details">
          {Object.keys(item.arguments).length > 0 ? (
            <section>
              <span>Arguments</span>
              <pre>{JSON.stringify(item.arguments, null, 2)}</pre>
            </section>
          ) : null}
          {item.output || failedLike ? (
            <section>
              <span>{failedLike ? "Error" : "Output"}</span>
              <pre>{item.output ?? "Tool failed without captured output."}</pre>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolCard(props: { item: ToolTimelineItem }) {
  const Renderer = resolveToolRenderer(props.item);
  if (Renderer) {
    return <Renderer item={props.item} />;
  }
  return <DefaultToolCard item={props.item} />;
}
