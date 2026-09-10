import type {
  EvalTaskDetail as EvalTaskDetailType,
  EvalTaskView,
} from "@pi-ling/contracts";
import { useMemo, useState } from "react";

import { EvalTaskDetail } from "./EvalTaskDetail";

function TaskBadge(props: { label: string; tone?: "accent" | "muted" }) {
  return (
    <span
      className={`eval-pill ${props.tone === "muted" ? "eval-pill-muted" : "eval-pill-accent"}`}
    >
      {props.label}
    </span>
  );
}

export function EvalCatalogTab(props: {
  tasks: EvalTaskView[];
  statsText: string;
  taskDetail: EvalTaskDetailType | null;
  selectedTaskId: string | null;
  running: boolean;
  onSelectTask: (taskId: string) => void;
  onRunTask: (taskId: string) => void;
  onSaveOverride: (input: {
    taskId: string;
    enabled: boolean;
    prompt: string;
  }) => void;
  onClearOverride: (taskId: string) => void;
  onOpenCatalog: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return props.tasks;
    return props.tasks.filter(
      (task) =>
        task.id.toLowerCase().includes(needle) ||
        task.title.toLowerCase().includes(needle),
    );
  }, [props.tasks, query]);

  return (
    <div className="eval-catalog-tab">
      <div className="eval-catalog-toolbar">
        <span className="eval-catalog-stats">{props.statsText}</span>
        <input
          type="search"
          className="eval-search"
          placeholder="搜索任务 ID 或标题…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="eval-catalog-layout">
        <div className="eval-task-list" role="list">
          {filtered.map((task) => (
            <button
              key={task.id}
              type="button"
              role="listitem"
              className={`eval-task-row ${
                props.selectedTaskId === task.id ? "is-selected" : ""
              }`}
              onClick={() => props.onSelectTask(task.id)}
            >
              <div className="eval-task-row-main">
                <span className="eval-task-row-id">{task.id}</span>
                <span className="eval-task-row-title">{task.title}</span>
              </div>
              <div className="eval-task-row-badges">
                {task.baselineIncluded ? (
                  <TaskBadge label="基线" />
                ) : null}
                {task.hasJudge ? <TaskBadge label="已评判" /> : null}
                <TaskBadge
                  label={task.enabled ? "已启用" : "已禁用"}
                  tone={task.enabled ? "accent" : "muted"}
                />
              </div>
            </button>
          ))}
        </div>
        <EvalTaskDetail
          detail={props.taskDetail}
          running={props.running}
          onRunTask={props.onRunTask}
          onEnabledChange={(enabled) => {
            if (!props.taskDetail) return;
            props.onSaveOverride({
              taskId: props.taskDetail.id,
              enabled,
              prompt: props.taskDetail.prompt,
            });
          }}
          onSavePrompt={(prompt) => {
            if (!props.taskDetail) return;
            props.onSaveOverride({
              taskId: props.taskDetail.id,
              enabled: props.taskDetail.enabled,
              prompt,
            });
          }}
          onClearOverride={props.onClearOverride}
          onOpenCatalog={props.onOpenCatalog}
        />
      </div>
    </div>
  );
}
