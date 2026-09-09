import type { EvalRunSuiteRequest } from "@pi-ling/contracts";
import { useState } from "react";

export function EvalToolbar(props: {
  running: boolean;
  progressText: string | null;
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
    <header className="eval-toolbar">
      <span
        className={`eval-status-dot ${props.running ? "is-running" : ""}`}
        aria-hidden="true"
      />
      <label className="eval-toolbar-field">
        <span>Driver</span>
        <select
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
      </label>
      <label className="eval-toolbar-field">
        <span>Runtime</span>
        <select
          value={runtime}
          disabled={props.running || driver !== "agent"}
          onChange={(event) =>
            setRuntime(event.target.value as EvalRunSuiteRequest["runtime"])
          }
        >
          <option value="native">Native</option>
          <option value="dsh">DSH</option>
        </select>
      </label>
      <label className="eval-toolbar-field">
        <span>Scope</span>
        <select
          value={scope}
          disabled={props.running}
          onChange={(event) =>
            setScope(event.target.value as EvalRunSuiteRequest["scope"])
          }
        >
          <option value="baseline">Baseline</option>
          <option value="full">Full</option>
        </select>
      </label>
      <label className="eval-toolbar-field eval-toolbar-label">
        <span>Label</span>
        <input
          type="text"
          value={label}
          disabled={props.running}
          placeholder="auto"
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <div className="eval-toolbar-actions">
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
          Run Suite
        </button>
        <button
          type="button"
          className="eval-button"
          disabled={!props.running}
          onClick={() => props.onCancel()}
        >
          Stop
        </button>
        <button
          type="button"
          className="eval-button"
          disabled={props.running}
          onClick={() => props.onRefresh()}
        >
          Refresh
        </button>
      </div>
      {props.progressText ? (
        <span className="eval-progress-text">{props.progressText}</span>
      ) : null}
    </header>
  );
}
