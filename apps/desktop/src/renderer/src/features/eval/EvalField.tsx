import type { ReactNode } from "react";

export function EvalField(props: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`eval-field ${props.className ?? ""}`.trim()}>
      <span className="eval-field-label">{props.label}</span>
      {props.children}
    </label>
  );
}
