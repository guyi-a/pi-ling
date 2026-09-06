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
        {item.status === "approved" ? "Allowed" : "Denied"} ·{" "}
        {item.approval.tool}
      </div>
    );
  }

  return (
    <div className="approval-card pending">
      <div className="approval-title">
        <ShieldAlert />
        Approval required · {item.approval.tool}
      </div>
      <div className="approval-target">{target(item)}</div>
      <p className="approval-reason">{item.approval.reason}</p>
      <details className="tool-arguments">
        <summary>Show full arguments</summary>
        <pre>{JSON.stringify(item.approval.arguments, null, 2)}</pre>
      </details>
      <div className="approval-actions">
        <button type="button" onClick={() => onDecision(item, false)}>
          Deny
        </button>
        <button
          className="allow"
          type="button"
          onClick={() => onDecision(item, true)}
        >
          Allow once
        </button>
      </div>
    </div>
  );
}
