import { useEffect, useState } from "react";

import { EvalCatalogTab } from "./EvalCatalogTab";
import { EvalCompareTab } from "./EvalCompareTab";
import { EvalResultsTab } from "./EvalResultsTab";
import { EVAL_TAB_LABELS, formatStatsText } from "./eval-copy";
import { EvalRunControls } from "./EvalRunControls";
import type { EvalTab } from "./useEvalWorkbench";
import { useEvalWorkbench } from "./useEvalWorkbench";

const EVAL_TABS: EvalTab[] = ["catalog", "results", "compare"];

export function EvalPanel(props: { active: boolean }) {
  const workbench = useEvalWorkbench();
  const [footerExpanded, setFooterExpanded] = useState(false);

  useEffect(() => {
    if (
      workbench.compareRequest &&
      !workbench.compareView &&
      workbench.state &&
      workbench.state.runs.length >= 2
    ) {
      void workbench.loadCompare(workbench.compareRequest);
    }
  }, [
    workbench.compareRequest,
    workbench.compareView,
    workbench.state,
    workbench.loadCompare,
  ]);

  const panelClassName = `eval-panel ${props.active ? "is-active" : "is-hidden"}`;

  if (workbench.error && !workbench.state) {
    return (
      <div className={panelClassName} aria-hidden={!props.active}>
        <div className="workbench-empty">
          <span className="empty-pane-mark">E</span>
          <strong>评测</strong>
          <p>{workbench.error}</p>
        </div>
      </div>
    );
  }

  if (!workbench.state) {
    return (
      <div className={panelClassName} aria-hidden={!props.active}>
        <div className="workbench-empty">
          <span className="empty-pane-mark">E</span>
          <strong>评测</strong>
          <p>加载评测工作台…</p>
        </div>
      </div>
    );
  }

  const statsText = formatStatsText(workbench.state.stats);

  return (
    <div className={panelClassName} aria-hidden={!props.active}>
      <header className="eval-header">
        {workbench.running ? (
          <span
            className="eval-status-dot is-running"
            aria-hidden="true"
            title="评测运行中"
          />
        ) : null}
        <nav className="eval-tabs" role="tablist" aria-label="评测视图">
          {EVAL_TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={workbench.tab === item}
              className={`eval-tab ${workbench.tab === item ? "is-active" : ""}`}
              onClick={() => workbench.setTab(item)}
            >
              {EVAL_TAB_LABELS[item]}
            </button>
          ))}
        </nav>
        <EvalRunControls
          running={workbench.running}
          availableRuntimes={workbench.state.availableEvalRuntimes}
          onRun={(request) => void workbench.runSuite(request)}
          onCancel={() => void workbench.cancelRun()}
          onRefresh={() => void workbench.refresh()}
        />
      </header>
      {workbench.progressText ? (
        <div className="eval-progress-bar">{workbench.progressText}</div>
      ) : null}
      {workbench.error ? (
        <div className="eval-error-banner">{workbench.error}</div>
      ) : null}
      <div className="eval-tab-body" role="tabpanel">
        {workbench.tab === "catalog" ? (
          <EvalCatalogTab
            tasks={workbench.state.tasks}
            statsText={statsText}
            taskDetail={workbench.taskDetail}
            selectedTaskId={workbench.selectedTaskId}
            running={workbench.running}
            onSelectTask={(taskId) => void workbench.loadTaskDetail(taskId)}
            onRunTask={(taskId) =>
              void workbench.runTask({
                taskId,
                driver: "reference",
                runtime: "native",
              })
            }
            onSaveOverride={(input) =>
              void workbench.saveOverride({
                taskId: input.taskId,
                enabled: input.enabled,
                prompt: input.prompt,
              })
            }
            onClearOverride={(taskId) => void workbench.clearOverride(taskId)}
            onOpenCatalog={() => void window.piLing.openEvalCatalog()}
          />
        ) : null}
        {workbench.tab === "results" ? (
          <EvalResultsTab
            runs={workbench.state.runs}
            selectedRunKey={workbench.selectedRunKey}
            selectedRun={workbench.selectedRun}
            results={workbench.displayedResults}
            running={workbench.running}
            onSelectRun={(key) => void workbench.selectRun(key)}
            onRunReference={() =>
              void workbench.runSuite({
                driver: "reference",
                runtime: "native",
                scope: "baseline",
              })
            }
          />
        ) : null}
        {workbench.tab === "compare" ? (
          <EvalCompareTab
            runs={workbench.state.runs}
            compareRequest={workbench.compareRequest}
            compareView={workbench.compareView}
            onCompare={(request) => void workbench.loadCompare(request)}
          />
        ) : null}
      </div>
      <footer className="eval-footer">
        <button
          type="button"
          className={`eval-footer-path ${footerExpanded ? "is-expanded" : ""}`}
          title={workbench.state.ledgerPath}
          onClick={() => setFooterExpanded((current) => !current)}
        >
          {workbench.state.ledgerPath}
        </button>
      </footer>
    </div>
  );
}

export function EvalPanelSkeleton() {
  return (
    <div className="eval-panel-skeleton" aria-hidden="true">
      <div className="eval-panel-skeleton-bar" />
      <div className="eval-panel-skeleton-body" />
    </div>
  );
}
