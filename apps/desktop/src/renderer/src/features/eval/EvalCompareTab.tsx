import type {
  EvalCompareRequest,
  EvalCompareView,
  EvalSuiteRunSummary,
} from "@pi-ling/contracts";

import { EvalEmptyState } from "./EvalEmptyState";
import { EvalField } from "./EvalField";
import { EvalStatusBadge } from "./EvalStatusBadge";
import { formatPassRate, runLabel } from "./eval-format";

function runOptionValue(run: EvalSuiteRunSummary): string {
  return `${run.experiment}\0${run.variant}`;
}

function findRun(
  runs: EvalSuiteRunSummary[],
  key: string,
): EvalSuiteRunSummary | undefined {
  const [experiment, variant] = key.split("\0");
  if (!experiment || !variant) return undefined;
  return runs.find(
    (run) => run.experiment === experiment && run.variant === variant,
  );
}

function regressionLabel(row: {
  statusChanged: boolean;
  baselineStatus: "passed" | "failed" | "skipped" | "error" | "missing";
  candidateStatus: "passed" | "failed" | "skipped" | "error" | "missing";
}): string | null {
  if (!row.statusChanged) return null;
  if (row.baselineStatus === "passed" && row.candidateStatus !== "passed") {
    return "回归";
  }
  if (row.baselineStatus !== "passed" && row.candidateStatus === "passed") {
    return "修复";
  }
  return "变化";
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
    const run = findRun(props.runs, value);
    props.onCompare({
      ...props.compareRequest,
      experiment,
      baselineVariant: variant,
      ...(run?.runtime
        ? { baselineRuntime: run.runtime }
        : { baselineRuntime: undefined }),
    });
  };

  const updateCandidate = (value: string) => {
    const [experiment, variant] = value.split("\0");
    if (!experiment || !variant || !props.compareRequest) return;
    const run = findRun(props.runs, value);
    props.onCompare({
      ...props.compareRequest,
      experiment,
      candidateVariant: variant,
      ...(run?.runtime
        ? { candidateRuntime: run.runtime }
        : { candidateRuntime: undefined }),
    });
  };

  if (props.runs.length < 2) {
    return (
      <EvalEmptyState
        title="对比"
        description="至少运行两次套件后，才能对比通过率与任务变化。"
      />
    );
  }

  const changedCount =
    props.compareView?.taskRows.filter((row) => row.statusChanged).length ?? 0;
  const regressions =
    props.compareView?.taskRows.filter(
      (row) =>
        row.statusChanged &&
        row.baselineStatus === "passed" &&
        row.candidateStatus !== "passed",
    ).length ?? 0;
  const fixes =
    props.compareView?.taskRows.filter(
      (row) =>
        row.statusChanged &&
        row.baselineStatus !== "passed" &&
        row.candidateStatus === "passed",
    ).length ?? 0;

  return (
    <div className="eval-compare-tab">
      <div className="eval-compare-toolbar">
        <EvalField label="基线">
          <select
            className="eval-control"
            value={baselineKey}
            onChange={(event) => updateBaseline(event.target.value)}
          >
            {props.runs.map((run) => (
              <option key={runOptionValue(run)} value={runOptionValue(run)}>
                {runLabel(run)}
              </option>
            ))}
          </select>
        </EvalField>
        <span className="eval-compare-vs">vs</span>
        <EvalField label="候选">
          <select
            className="eval-control"
            value={candidateKey}
            onChange={(event) => updateCandidate(event.target.value)}
          >
            {props.runs.map((run) => (
              <option key={runOptionValue(run)} value={runOptionValue(run)}>
                {runLabel(run)}
              </option>
            ))}
          </select>
        </EvalField>
      </div>
      {props.compareView ? (
        <>
          <div className="eval-kpi-grid">
            <div className="eval-kpi-card">
              <span className="eval-kpi-label">通过率</span>
              <strong className="eval-kpi-value">
                {formatPassRate(props.compareView.summary.baseline_pass_rate)} →{" "}
                {formatPassRate(props.compareView.summary.candidate_pass_rate)}
              </strong>
            </div>
            <div className="eval-kpi-card">
              <span className="eval-kpi-label">Δ 通过率</span>
              <strong className="eval-kpi-value">
                {props.compareView.summary.pass_rate_lift >= 0 ? "+" : ""}
                {formatPassRate(props.compareView.summary.pass_rate_lift)}
              </strong>
            </div>
            <div className="eval-kpi-card">
              <span className="eval-kpi-label">变化任务</span>
              <strong className="eval-kpi-value">{changedCount}</strong>
            </div>
            <div className="eval-kpi-card">
              <span className="eval-kpi-label">回归 / 修复</span>
              <strong className="eval-kpi-value">
                {regressions} / {fixes}
              </strong>
            </div>
          </div>
          <div className="eval-compare-list">
            {props.compareView.taskRows.map((row) => {
              const deltaLabel = regressionLabel(row);
              return (
                <div
                  key={row.taskId}
                  className={`eval-compare-row ${
                    row.statusChanged ? "is-changed" : ""
                  }`}
                >
                  <span className="eval-compare-task-id">{row.taskId}</span>
                  <div className="eval-compare-statuses">
                    <EvalStatusBadge status={row.baselineStatus} />
                    <span className="eval-compare-arrow">→</span>
                    <EvalStatusBadge status={row.candidateStatus} />
                  </div>
                  <span className="eval-compare-delta">
                    {row.durationDeltaMs !== undefined
                      ? `${row.durationDeltaMs >= 0 ? "+" : ""}${row.durationDeltaMs}ms`
                      : "—"}
                  </span>
                  <span className="eval-compare-delta">
                    {row.toolCallsDelta !== undefined
                      ? `${row.toolCallsDelta >= 0 ? "+" : ""}${row.toolCallsDelta} tools`
                      : "—"}
                  </span>
                  {deltaLabel ? (
                    <span className="eval-pill eval-pill-accent">{deltaLabel}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
          {props.compareView.summary.diagnostics.length > 0 ? (
            <details className="eval-compare-diagnostics">
              <summary>诊断详情</summary>
              <ul>
                {props.compareView.summary.diagnostics.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : (
        <EvalEmptyState
          title="对比"
          description="选择基线与候选运行后开始对比。"
        />
      )}
    </div>
  );
}
