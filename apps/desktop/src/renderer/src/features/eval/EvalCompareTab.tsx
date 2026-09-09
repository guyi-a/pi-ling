import type {
  EvalCompareRequest,
  EvalCompareView,
  EvalSuiteRunSummary,
} from "@pi-ling/contracts";

import { formatPassRate, runLabel, statusClass, statusLabel } from "./eval-format";

function runOptionValue(run: EvalSuiteRunSummary): string {
  return `${run.experiment}\0${run.variant}`;
}

export function EvalCompareTab(props: {
  runs: EvalSuiteRunSummary[];
  compareRequest: EvalCompareRequest | null;
  compareView: EvalCompareView | null;
  onCompare: (request: EvalCompareRequest) => void;
}) {
  const baselineKey = props.compareRequest
    ? `${props.compareRequest.experiment}\0${props.compareRequest.baselineVariant}`
    : "";
  const candidateKey = props.compareRequest
    ? `${props.compareRequest.experiment}\0${props.compareRequest.candidateVariant}`
    : "";

  const updateBaseline = (value: string) => {
    const [experiment, variant] = value.split("\0");
    if (!experiment || !variant || !props.compareRequest) return;
    props.onCompare({
      ...props.compareRequest,
      experiment,
      baselineVariant: variant,
    });
  };

  const updateCandidate = (value: string) => {
    const [experiment, variant] = value.split("\0");
    if (!experiment || !variant || !props.compareRequest) return;
    props.onCompare({
      ...props.compareRequest,
      experiment,
      candidateVariant: variant,
    });
  };

  if (props.runs.length < 2) {
    return (
      <div className="eval-empty">
        <p>Run at least two suites to compare pass rate and per-task changes.</p>
      </div>
    );
  }

  return (
    <div className="eval-compare-tab">
      <div className="eval-compare-toolbar">
        <label>
          <span>Baseline</span>
          <select value={baselineKey} onChange={(e) => updateBaseline(e.target.value)}>
            {props.runs.map((run) => (
              <option key={runOptionValue(run)} value={runOptionValue(run)}>
                {runLabel(run)}
              </option>
            ))}
          </select>
        </label>
        <span className="eval-compare-vs">vs</span>
        <label>
          <span>Candidate</span>
          <select
            value={candidateKey}
            onChange={(e) => updateCandidate(e.target.value)}
          >
            {props.runs.map((run) => (
              <option key={runOptionValue(run)} value={runOptionValue(run)}>
                {runLabel(run)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {props.compareView ? (
        <>
          <div className="eval-compare-kpi">
            <span>
              Pass rate{" "}
              {formatPassRate(props.compareView.summary.baseline_pass_rate)} →{" "}
              {formatPassRate(props.compareView.summary.candidate_pass_rate)}
            </span>
            <span>
              Lift {props.compareView.summary.pass_rate_lift >= 0 ? "+" : ""}
              {formatPassRate(props.compareView.summary.pass_rate_lift)}
            </span>
            <span>
              Avg duration Δ{" "}
              {props.compareView.summary.metrics.duration_ms.delta >= 0 ? "+" : ""}
              {props.compareView.summary.metrics.duration_ms.delta}ms
            </span>
            <span>
              Avg tools Δ{" "}
              {props.compareView.summary.metrics.tool_calls.delta >= 0 ? "+" : ""}
              {props.compareView.summary.metrics.tool_calls.delta}
            </span>
          </div>
          <table className="eval-table eval-compare-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Baseline</th>
                <th>Candidate</th>
                <th>Δ Duration</th>
                <th>Δ Tools</th>
              </tr>
            </thead>
            <tbody>
              {props.compareView.taskRows.map((row) => (
                <tr
                  key={row.taskId}
                  className={row.statusChanged ? "is-changed" : undefined}
                >
                  <td>{row.taskId}</td>
                  <td>
                    <span className={`eval-status ${statusClass(row.baselineStatus)}`}>
                      {statusLabel(row.baselineStatus)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`eval-status ${statusClass(row.candidateStatus)}`}
                    >
                      {statusLabel(row.candidateStatus)}
                    </span>
                  </td>
                  <td>
                    {row.durationDeltaMs !== undefined
                      ? `${row.durationDeltaMs >= 0 ? "+" : ""}${row.durationDeltaMs}ms`
                      : "—"}
                  </td>
                  <td>
                    {row.toolCallsDelta !== undefined
                      ? `${row.toolCallsDelta >= 0 ? "+" : ""}${row.toolCallsDelta}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {props.compareView.summary.diagnostics.length > 0 ? (
            <details className="eval-compare-diagnostics">
              <summary>Diagnostics</summary>
              <ul>
                {props.compareView.summary.diagnostics.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <div className="eval-empty">
          <p>Select baseline and candidate runs to compare.</p>
        </div>
      )}
    </div>
  );
}
