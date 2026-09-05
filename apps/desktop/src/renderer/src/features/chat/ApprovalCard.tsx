import { Check, ShieldAlert, X } from "lucide-react";

import type { ApprovalTimelineItem } from "../../timeline/reducer";

function target(item: ApprovalTimelineItem): string {
  const effect = item.approval.effect;
  if (typeof effect["path"] === "string") {
    return effect["path"];
  }
  if (typeof effect["command"] === "string") {
    return effect["command"];
  }
  return item.approval.tool;
}

export function ApprovalCard(props: {
  item: ApprovalTimelineItem;
  onDecision: (item: ApprovalTimelineItem, approved: boolean) => void;
}) {
  const { item, onDecision } = props;
  if (item.status !== "pending") {
    const Icon = item.status === "approved" ? Check : X;
    return (
      <div className="approval-card resolved">
        <Icon />
        {item.status === "approved" ? "已允许" : "已拒绝"} ·{" "}
        {item.approval.tool}
      </div>
    );
  }

  return (
    <div className="approval-card pending">
      <div className="approval-title">
        <ShieldAlert />
        需要确认 · {item.approval.tool}
      </div>
      <div className="approval-target">{target(item)}</div>
      <p className="approval-reason">{item.approval.reason}</p>
      <details className="tool-arguments">
        <summary>查看完整参数</summary>
        <pre>{JSON.stringify(item.approval.arguments, null, 2)}</pre>
      </details>
      <div className="approval-actions">
        <button type="button" onClick={() => onDecision(item, false)}>
          拒绝
        </button>
        <button
          className="allow"
          type="button"
          onClick={() => onDecision(item, true)}
        >
          仅允许这次
        </button>
      </div>
    </div>
  );
}
