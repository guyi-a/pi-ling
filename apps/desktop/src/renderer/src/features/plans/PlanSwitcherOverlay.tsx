import { useEffect, useRef, type RefObject } from "react";

import {
  planDisplayTitle,
  planStatusLabel,
  shortRunId,
} from "./project-session-plans";
import type { SessionPlan } from "./types";

export function PlanSwitcherOverlay(props: {
  plans: SessionPlan[];
  selectedRunId: string | null;
  anchorRef: RefObject<HTMLElement | null>;
  onSelect: (runId: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (props.anchorRef.current?.contains(target)) return;
      props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [props]);

  return (
    <div
      ref={panelRef}
      className="plans-switcher"
      role="listbox"
      aria-label="切换 Plan"
    >
      <div className="plans-switcher-head">
        <span className="plans-switcher-label">Plans</span>
        <span className="plans-switcher-count">{props.plans.length}</span>
      </div>
      <div className="plans-switcher-list">
        {props.plans.map((plan) => {
          const selected = plan.runId === props.selectedRunId;
          const title = planDisplayTitle(plan);
          return (
            <button
              key={plan.runId}
              type="button"
              role="option"
              aria-selected={selected}
              className={`plans-switcher-item ${selected ? "is-selected" : ""}`}
              onClick={() => {
                props.onSelect(plan.runId);
                props.onClose();
              }}
              title={title}
            >
              <span className="plans-switcher-item-title">{title}</span>
              <span className="plans-switcher-item-meta">
                <span
                  className={`plans-badge plans-badge-${plan.status} plans-switcher-badge`}
                >
                  {planStatusLabel(plan.status)}
                </span>
                <span className="plans-switcher-run">{shortRunId(plan.runId)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
