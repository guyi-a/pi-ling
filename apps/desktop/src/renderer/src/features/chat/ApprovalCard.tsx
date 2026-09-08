import { Check, ShieldAlert, X } from "lucide-react";

import { toolNameLabel, toolTarget } from "../../run-activity/tool-taxonomy";
import type { ApprovalTimelineItem } from "../../timeline/reducer";

function target(item: ApprovalTimelineItem): string {
  const effect = item.approval.effect;
  if (typeof effect["path"] === "string") {
    return effect["path"];
  }
  if (typeof effect["command"] === "string") {
    return effect["command"];
  }

  const fromArguments = toolTarget({
    kind: "tool",
    id: item.id,
    runId: item.runId,
    turnId: item.turnId,
    createdSeq: item.createdSeq,
    callId: item.approval.callId,
    tool: item.approval.tool,
    arguments: item.approval.arguments,
    status: "requested",
  });
  if (fromArguments !== item.approval.tool) {
    return fromArguments;
  }

  if (typeof effect["note"] === "string" && effect["note"]) {
    return effect["note"];
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
        需要审批 · {toolNameLabel(item.approval.tool)}
      </div>
      <div className="approval-card-body">
        <div className="approval-target">{target(item)}</div>
        <p className="approval-reason">{item.approval.reason}</p>
        <details className="approval-details">
          <summary>查看完整参数</summary>
          <pre>{JSON.stringify(item.approval.arguments, null, 2)}</pre>
        </details>
      </div>
      <div className="approval-actions">
        <button type="button" onClick={() => onDecision(item, false)}>
          拒绝
        </button>
        <button
          className="allow"
          type="button"
          onClick={() => onDecision(item, true)}
        >
          允许一次
        </button>
      </div>
    </div>
  );
}
