import type { EvalTaskDetail as EvalTaskDetailType } from "@pi-ling/contracts";
import { useEffect, useState } from "react";

export function EvalTaskDetail(props: {
  detail: EvalTaskDetailType | null;
  running: boolean;
  onRunTask: (taskId: string) => void;
  onSave: (input: {
    enabled: boolean;
    prompt: string;
  }) => void;
  onClearOverride: (taskId: string) => void;
  onOpenCatalog: () => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!props.detail) return;
    setEnabled(props.detail.enabled);
    setPrompt(props.detail.prompt);
  }, [props.detail]);

  if (!props.detail) {
    return (
      <div className="eval-task-detail eval-task-detail-empty">
        Select a task to inspect prompt, fixture, and verify commands.
      </div>
    );
  }

  return (
    <div className="eval-task-detail">
      <div className="eval-task-detail-header">
        <strong>{props.detail.title}</strong>
        <span className="eval-task-detail-id">{props.detail.id}</span>
        {props.detail.hasLocalOverride ? (
          <span className="eval-override-badge">Override</span>
        ) : null}
      </div>
      <label className="eval-task-detail-field">
        <span>Enabled</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
      </label>
      <label className="eval-task-detail-field eval-task-detail-prompt">
        <span>Prompt</span>
        <textarea
          value={prompt}
          rows={4}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <div className="eval-task-detail-section">
        <h4>Fixture files</h4>
        <ul>
          {props.detail.fixtureFiles.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
        <pre>{props.detail.fixtureCommand}</pre>
      </div>
      <div className="eval-task-detail-section">
        <h4>Verify</h4>
        {props.detail.verify.map((row) => (
          <pre key={row.name}>
            {row.name}: {row.command}
          </pre>
        ))}
      </div>
      {props.detail.judge ? (
        <div className="eval-task-detail-section">
          <h4>Judge</h4>
          <pre>{props.detail.judge.rubric}</pre>
        </div>
      ) : null}
      <div className="eval-task-detail-actions">
        <button
          type="button"
          className="eval-button eval-button-primary"
          disabled={props.running}
          onClick={() => props.onRunTask(props.detail!.id)}
        >
          Run Task
        </button>
        <button
          type="button"
          className="eval-button"
          onClick={() =>
            props.onSave({ enabled, prompt: prompt.trim() })
          }
        >
          Save Override
        </button>
        {props.detail.hasLocalOverride ? (
          <button
            type="button"
            className="eval-button"
            onClick={() => props.onClearOverride(props.detail!.id)}
          >
            Reset Override
          </button>
        ) : null}
        <button
          type="button"
          className="eval-button"
          onClick={() => props.onOpenCatalog()}
        >
          Open Catalog
        </button>
      </div>
    </div>
  );
}
