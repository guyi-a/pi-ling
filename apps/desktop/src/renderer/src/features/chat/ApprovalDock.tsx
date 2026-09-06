import type { ApprovalTimelineItem } from "../../timeline/reducer";
import { ApprovalCard } from "./ApprovalCard";

export function ApprovalDock(props: {
  approvals: readonly ApprovalTimelineItem[];
  onDecision: (
    item: ApprovalTimelineItem,
    approved: boolean,
  ) => void;
}) {
  const current = props.approvals[0];
  if (!current) return null;

  return (
    <section className="approval-dock" aria-label="Pending approval">
      {props.approvals.length > 1 ? (
        <div className="approval-dock-count">
          1/{props.approvals.length}
        </div>
      ) : null}
      <ApprovalCard item={current} onDecision={props.onDecision} />
    </section>
  );
}
