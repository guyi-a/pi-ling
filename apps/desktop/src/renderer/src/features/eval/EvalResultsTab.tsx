import type { EvalRunResultView, EvalSuiteRunSummary } from "@pi-ling/contracts";
import { useState } from "react";

import { EvalEmptyState } from "./EvalEmptyState";
import { EvalField } from "./EvalField";
import { EvalSectionHeader } from "./EvalSectionHeader";
import { EvalStatusBadge } from "./EvalStatusBadge";
import { formatDuration, runLabel } from "./eval-format";

export function EvalResultsTab(props: {
  runs: EvalSuiteRunSummary[];
  selectedRunKey: string | null;
  selectedRun: EvalSuiteRunSummary | undefined;
  results: EvalRunResultView[];
  running: boolean;
  onSelectRun: (key: string) => void;
  onRunReference: () => void;
}) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  if (props.runs.length === 0 && !props.running) {
    return (
      <EvalEmptyState
        title="结果"
        description="还没有评测运行记录。"
        action={
          <button
            type="button"
            className="eval-button eval-button-primary"
            onClick={() => props.onRunReference()}
          >
            运行 Reference 套件
          </button>
        }
      />
    );
  }

  return (
    <div className="eval-results-tab">
      <div className="eval-results-toolbar">
        <EvalField label="运行">
          <select
            className="eval-control"
            value={props.selectedRunKey ?? ""}
            onChange={(event) => props.onSelectRun(event.target.value)}
          >
            {props.runs.map((run) => (
              <option
                key={`${run.experiment}\0${run.variant}`}
                value={`${run.experiment}\0${run.variant}`}
              >
                {runLabel(run)}
              </option>
            ))}
          </select>
        </EvalField>
        {props.selectedRun ? (
          <div className="eval-stat-chips">
            <span className="eval-stat-chip">
              {props.selectedRun.passed}/{props.selectedRun.total} 通过
            </span>
            <span className="eval-stat-chip">{props.selectedRun.driver}</span>
            {props.selectedRun.runtime ? (
              <span className="eval-stat-chip">{props.selectedRun.runtime}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="eval-result-list">
        {props.results.map((result) => {
          const expanded = expandedTaskId === result.taskId;
          return (
            <div
              key={result.taskId}
              className={`eval-result-item ${expanded ? "is-expanded" : ""}`}
            >
              <button
                type="button"
                className="eval-result-row"
                aria-expanded={expanded}
                onClick={() =>
                  setExpandedTaskId((current) =>
                    current === result.taskId ? null : result.taskId,
                  )
                }
              >
                <span className="eval-result-chevron">{expanded ? "▼" : "▶"}</span>
                <span className="eval-result-id">{result.taskId}</span>
                <EvalStatusBadge status={result.status} />
                <span className="eval-result-meta">
                  {formatDuration(result.durationMs)}
                </span>
                <span className="eval-result-meta">
                  {result.verifyPassed}/{result.verifyTotal} verify
                </span>
              </button>
              {expanded ? (
                <div className="eval-result-detail">
                  {result.error ? (
                    <div className="eval-result-section">
                      <EvalSectionHeader>错误</EvalSectionHeader>
                      <p className="eval-result-text">{result.error}</p>
                    </div>
                  ) : null}
                  {result.judgeRationale ? (
                    <div className="eval-result-section">
                      <EvalSectionHeader>评判说明</EvalSectionHeader>
                      <pre className="eval-code-block">{result.judgeRationale}</pre>
                    </div>
                  ) : null}
                  {result.verifyDetails.map((verify) => (
                    <div key={verify.name} className="eval-result-section">
                      <EvalSectionHeader>
                        {verify.name} (exit {verify.exitCode})
                      </EvalSectionHeader>
                      {verify.stdout ? (
                        <pre className="eval-code-block">{verify.stdout}</pre>
                      ) : null}
                      {verify.stderr ? (
                        <pre className="eval-code-block eval-code-block-error">
                          {verify.stderr}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
