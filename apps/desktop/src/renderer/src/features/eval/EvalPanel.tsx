import { useEffect } from "react";

import { EvalCatalogTab } from "./EvalCatalogTab";
import { EvalCompareTab } from "./EvalCompareTab";
import { EvalResultsTab } from "./EvalResultsTab";
import { EvalToolbar } from "./EvalToolbar";
import { useEvalWorkbench } from "./useEvalWorkbench";

export function EvalPanel() {
  const workbench = useEvalWorkbench();

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

  if (workbench.error && !workbench.state) {
    return (
      <div className="workbench-empty">
        <strong>Eval</strong>
        <p>{workbench.error}</p>
      </div>
    );
  }

  if (!workbench.state) {
    return (
      <div className="workbench-empty">
        <strong>Eval</strong>
        <p>Loading eval workbench…</p>
      </div>
    );
  }

  const statsText = `${workbench.state.stats.total} tasks · ${workbench.state.stats.baseline} baseline · ${workbench.state.stats.judged} judged`;

  return (
    <div className="eval-panel">
      <EvalToolbar
        running={workbench.running}
        progressText={workbench.progressText}
        onRun={(request) => void workbench.runSuite(request)}
        onCancel={() => void workbench.cancelRun()}
        onRefresh={() => void workbench.refresh()}
      />
      {workbench.error ? (
        <div className="eval-error-banner">{workbench.error}</div>
      ) : null}
      <nav className="eval-tabs" aria-label="Eval views">
        {(["catalog", "results", "compare"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`eval-tab ${workbench.tab === item ? "is-active" : ""}`}
            onClick={() => workbench.setTab(item)}
          >
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      <div className="eval-tab-body">
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
        <span className="eval-footer-path">{workbench.state.ledgerPath}</span>
      </footer>
    </div>
  );
}
