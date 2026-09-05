import type { ApprovalTimelineItem } from "../../timeline/reducer";

export function ApprovalCard(props: {
  item: ApprovalTimelineItem;
  onDecision: (item: ApprovalTimelineItem, approved: boolean) => void;
}) {
  const { item, onDecision } = props;
  return (
    <div className={`approval-card ${item.status}`}>
      <strong>
        {item.status === "pending"
          ? "Approval required"
          : item.status === "approved"
            ? "Allowed"
            : "Denied"}{" "}
        · {item.approval.tool}
      </strong>
      <p>{item.approval.reason}</p>
      <pre>{JSON.stringify(item.approval.arguments, null, 2)}</pre>
      {item.status === "pending" ? (
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
      ) : null}
    </div>
  );
}
