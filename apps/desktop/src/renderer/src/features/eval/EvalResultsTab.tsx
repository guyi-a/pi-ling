import type { EvalRunResultView, EvalSuiteRunSummary } from "@pi-ling/contracts";
import { Fragment, useState } from "react";

import { formatDuration, runLabel, statusClass, statusLabel } from "./eval-format";

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
      <div className="eval-empty">
        <p>No eval runs yet.</p>
        <button
          type="button"
          className="eval-button eval-button-primary"
          onClick={() => props.onRunReference()}
        >
          Run Reference Suite
        </button>
      </div>
    );
  }

  return (
    <div className="eval-results-tab">
      <div className="eval-results-toolbar">
        <label>
          <span>Run</span>
          <select
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
        </label>
        {props.selectedRun ? (
          <span className="eval-results-summary">
            {props.selectedRun.passed}/{props.selectedRun.total} passed ·{" "}
            {props.selectedRun.driver}
            {props.selectedRun.runtime ? ` · ${props.selectedRun.runtime}` : ""}
          </span>
        ) : null}
      </div>
      <table className="eval-table eval-results-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Verify</th>
            <th>Violations</th>
            <th>Tools</th>
            <th>Judge</th>
          </tr>
        </thead>
        <tbody>
          {props.results.map((result) => (
            <Fragment key={result.taskId}>
              <tr
                className="eval-results-row"
                onClick={() =>
                  setExpandedTaskId((current) =>
                    current === result.taskId ? null : result.taskId,
                  )
                }
              >
                <td>{result.taskId}</td>
                <td>
                  <span className={`eval-status ${statusClass(result.status)}`}>
                    {statusLabel(result.status)}
                  </span>
                </td>
                <td>{formatDuration(result.durationMs)}</td>
                <td>
                  {result.verifyPassed}/{result.verifyTotal}
                </td>
                <td>{result.violations.length || "—"}</td>
                <td>{result.toolCalls ?? "—"}</td>
                <td>
                  {result.judgeScore !== undefined
                    ? result.judgeScore.toFixed(2)
                    : "—"}
                </td>
              </tr>
              {expandedTaskId === result.taskId ? (
                <tr className="eval-results-detail-row">
                  <td colSpan={7}>
                    {result.error ? <p>{result.error}</p> : null}
                    {result.judgeRationale ? (
                      <pre>{result.judgeRationale}</pre>
                    ) : null}
                    {result.verifyDetails.map((verify) => (
                      <div key={verify.name} className="eval-verify-block">
                        <strong>
                          {verify.name} (exit {verify.exitCode})
                        </strong>
                        {verify.stdout ? <pre>{verify.stdout}</pre> : null}
                        {verify.stderr ? <pre>{verify.stderr}</pre> : null}
                      </div>
                    ))}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
