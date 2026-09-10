import type { ReactNode } from "react";

export function EvalEmptyState(props: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="eval-empty">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
      {props.action ? <div className="eval-empty-action">{props.action}</div> : null}
    </div>
  );
}
