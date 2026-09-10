import type { EvalTaskDetail as EvalTaskDetailType } from "@pi-ling/contracts";
import { useEffect, useState } from "react";

import { EvalSectionHeader } from "./EvalSectionHeader";

export function EvalTaskDetail(props: {
  detail: EvalTaskDetailType | null;
  running: boolean;
  onRunTask: (taskId: string) => void;
  onSavePrompt: (prompt: string) => void;
  onEnabledChange: (enabled: boolean) => void;
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
        选择任务以查看 prompt、fixture 与 verify 命令。
      </div>
    );
  }

  return (
    <div className="eval-task-detail">
      <div className="eval-task-detail-header">
        <div className="eval-task-detail-heading">
          <strong>{props.detail.title}</strong>
          <span className="eval-task-detail-id">{props.detail.id}</span>
          {props.detail.hasLocalOverride ? (
            <span className="eval-override-badge">已覆盖</span>
          ) : null}
        </div>
        <label className="eval-enable-toggle">
          <span className="eval-enable-toggle-label">启用</span>
          <input
            type="checkbox"
            className="eval-enable-toggle-input"
            checked={enabled}
            onChange={(event) => {
              const next = event.target.checked;
              setEnabled(next);
              props.onEnabledChange(next);
            }}
          />
        </label>
      </div>
      <label className="eval-task-detail-field eval-task-detail-prompt">
        <span>Prompt</span>
        <textarea
          value={prompt}
          rows={4}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <div className="eval-task-detail-section">
        <EvalSectionHeader>Fixture 文件</EvalSectionHeader>
        <ul>
          {props.detail.fixtureFiles.map((file) => (
            <li key={file}>{file}</li>
          ))}
        </ul>
        <pre className="eval-code-block">{props.detail.fixtureCommand}</pre>
      </div>
      <div className="eval-task-detail-section">
        <EvalSectionHeader>Verify</EvalSectionHeader>
        {props.detail.verify.map((row) => (
          <pre key={row.name} className="eval-code-block">
            {row.name}: {row.command}
          </pre>
        ))}
      </div>
      {props.detail.judge ? (
        <div className="eval-task-detail-section">
          <EvalSectionHeader>Judge</EvalSectionHeader>
          <pre className="eval-code-block">{props.detail.judge.rubric}</pre>
        </div>
      ) : null}
      <div className="eval-task-detail-actions">
        <button
          type="button"
          className="eval-button eval-button-primary"
          disabled={props.running}
          onClick={() => props.onRunTask(props.detail!.id)}
        >
          运行此任务
        </button>
        <button
          type="button"
          className="eval-button"
          onClick={() => props.onSavePrompt(prompt.trim())}
        >
          保存 Prompt
        </button>
        {props.detail.hasLocalOverride ? (
          <button
            type="button"
            className="eval-button"
            onClick={() => props.onClearOverride(props.detail!.id)}
          >
            清除覆盖
          </button>
        ) : null}
        <button
          type="button"
          className="eval-button"
          onClick={() => props.onOpenCatalog()}
        >
          打开目录
        </button>
      </div>
    </div>
  );
}
