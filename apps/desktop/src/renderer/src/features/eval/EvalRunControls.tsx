import type { EvalRunSuiteRequest } from "@pi-ling/contracts";
import { useState } from "react";

import { EvalField } from "./EvalField";

export function EvalRunControls(props: {
  running: boolean;
  onRun: (request: EvalRunSuiteRequest) => void;
  onCancel: () => void;
  onRefresh: () => void;
}) {
  const [driver, setDriver] =
    useState<EvalRunSuiteRequest["driver"]>("reference");
  const [runtime, setRuntime] =
    useState<EvalRunSuiteRequest["runtime"]>("native");
  const [scope, setScope] = useState<EvalRunSuiteRequest["scope"]>("baseline");
  const [label, setLabel] = useState("");

  return (
    <div className="eval-run-controls">
      <EvalField label="驱动">
        <select
          className="eval-control"
          value={driver}
          disabled={props.running}
          onChange={(event) =>
            setDriver(event.target.value as EvalRunSuiteRequest["driver"])
          }
        >
          <option value="reference">Reference</option>
          <option value="agent">Agent</option>
          <option value="noop">Noop</option>
        </select>
      </EvalField>
      <EvalField
        label="运行时"
        className={driver !== "agent" ? "eval-field-inactive-hint" : undefined}
      >
        <select
          className="eval-control"
          value={runtime}
          disabled={props.running}
          title={
            driver !== "agent"
              ? "仅 Agent 驱动时使用；切换后将自动选 Agent"
              : undefined
          }
          onChange={(event) => {
            setRuntime(event.target.value as EvalRunSuiteRequest["runtime"]);
            if (driver !== "agent") {
              setDriver("agent");
            }
          }}
        >
          <option value="native">Native</option>
          <option value="dsh">DSH</option>
        </select>
      </EvalField>
      <EvalField label="范围">
        <select
          className="eval-control"
          value={scope}
          disabled={props.running}
          onChange={(event) =>
            setScope(event.target.value as EvalRunSuiteRequest["scope"])
          }
        >
          <option value="baseline">Baseline</option>
          <option value="full">Full</option>
        </select>
      </EvalField>
      <EvalField label="标签" className="eval-field-label-input">
        <input
          className="eval-control"
          type="text"
          value={label}
          disabled={props.running}
          placeholder="自动"
          onChange={(event) => setLabel(event.target.value)}
        />
      </EvalField>
      <div className="eval-run-actions">
        <button
          type="button"
          className="eval-button eval-button-primary"
          disabled={props.running}
          onClick={() =>
            props.onRun({
              driver,
              runtime,
              scope,
              ...(label.trim() ? { variantLabel: label.trim() } : {}),
            })
          }
        >
          运行套件
        </button>
        <button
          type="button"
          className="eval-button"
          disabled={!props.running}
          onClick={() => props.onCancel()}
        >
          停止
        </button>
        <button
          type="button"
          className="eval-button"
          disabled={props.running}
          onClick={() => props.onRefresh()}
        >
          刷新
        </button>
      </div>
    </div>
  );
}
