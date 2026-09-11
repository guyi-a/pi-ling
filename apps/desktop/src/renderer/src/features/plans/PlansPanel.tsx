import type { RuntimeKind } from "@pi-ling/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "../chat/Markdown";
import type { TimelineItem, TimelineRun } from "../../timeline/reducer";
import { PlanSwitcherOverlay } from "./PlanSwitcherOverlay";
import { PlansEmptyState } from "./PlansEmptyState";
import {
  planDisplayTitle,
  planStatusLabel,
  projectSessionPlans,
  sortedSessionPlans,
} from "./project-session-plans";
import type { SessionPlan } from "./types";

export function PlansPanel(props: {
  sessionId: string | null;
  items: TimelineItem[];
  runs: Record<string, TimelineRun>;
  activeRunId: string | null;
  focusRunId?: string | null;
  active: boolean;
  runtimeKind: RuntimeKind;
  buildRunByPlanRunId?: ReadonlyMap<string, string>;
  onBuild?: (plan: SessionPlan) => void;
  onCancelPlan?: (plan: SessionPlan) => void;
  buildPending?: boolean;
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);

  const plans = useMemo(
    () =>
      projectSessionPlans(props.items, props.runs, {
        buildRunByPlanRunId: props.buildRunByPlanRunId,
        runtimeKind: props.runtimeKind,
      }),
    [props.buildRunByPlanRunId, props.items, props.runtimeKind, props.runs],
  );
  const planList = useMemo(() => sortedSessionPlans(plans), [plans]);

  useEffect(() => {
    if (props.focusRunId && plans.has(props.focusRunId)) {
      setSelectedRunId(props.focusRunId);
    }
  }, [props.focusRunId, plans]);

  useEffect(() => {
    if (selectedRunId && plans.has(selectedRunId)) return;
    setSelectedRunId(planList[0]?.runId ?? null);
  }, [planList, plans, selectedRunId]);

  const selectedPlan =
    selectedRunId && plans.has(selectedRunId)
      ? (plans.get(selectedRunId) ?? null)
      : null;

  if (!props.sessionId) {
    return <PlansEmptyState hasSession={false} />;
  }

  const canBuild =
    props.runtimeKind === "native" || props.runtimeKind === "codex"
      ? selectedPlan?.status === "ready"
      : selectedPlan?.status === "ready" &&
        Boolean(selectedPlan.pendingApproval);
  const showCancel = props.runtimeKind === "dsh" && canBuild;

  return (
    <div
      className={`plans-panel ${props.active ? "is-active" : "is-hidden"}`}
      aria-hidden={!props.active}
    >
      {!selectedPlan || !selectedPlan.markdown ? (
        <PlansEmptyState hasSession />
      ) : (
        <div className="plans-preview-shell">
          <div className="plans-header-wrap">
            <header className="plans-header">
              <button
                ref={pickerRef}
                type="button"
                className="plans-picker"
                aria-expanded={switcherOpen}
                aria-label="切换 Plan"
                title={planDisplayTitle(selectedPlan)}
                onClick={() => setSwitcherOpen((current) => !current)}
              >
                {planDisplayTitle(selectedPlan)}
              </button>
              <span
                className={`plans-badge plans-badge-${selectedPlan.status}`}
              >
                {planStatusLabel(selectedPlan.status)}
              </span>
              {canBuild ? (
                <div className="plans-action-buttons">
                  {showCancel ? (
                    <button
                      className="plans-cancel-button"
                      type="button"
                      disabled={props.buildPending}
                      onClick={() => props.onCancelPlan?.(selectedPlan)}
                    >
                      暂不执行
                    </button>
                  ) : null}
                  <button
                    className="plans-build-button"
                    type="button"
                    disabled={props.buildPending}
                    onClick={() => props.onBuild?.(selectedPlan)}
                  >
                    Build
                  </button>
                </div>
              ) : null}
            </header>
            {switcherOpen && planList.length > 0 ? (
              <PlanSwitcherOverlay
                plans={planList}
                selectedRunId={selectedRunId}
                anchorRef={pickerRef}
                onSelect={setSelectedRunId}
                onClose={() => setSwitcherOpen(false)}
              />
            ) : null}
          </div>
          <div className="plans-markdown">
            <Markdown>{selectedPlan.markdown}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

