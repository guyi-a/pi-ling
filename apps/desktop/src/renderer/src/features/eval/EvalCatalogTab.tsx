import type {
  EvalTaskDetail as EvalTaskDetailType,
  EvalTaskView,
} from "@pi-ling/contracts";
import { useMemo, useState } from "react";

import { EvalTaskDetail } from "./EvalTaskDetail";

export function EvalCatalogTab(props: {
  tasks: EvalTaskView[];
  statsText: string;
  taskDetail: EvalTaskDetailType | null;
  selectedTaskId: string | null;
  running: boolean;
  onSelectTask: (taskId: string) => void;
  onRunTask: (taskId: string) => void;
  onSaveOverride: (input: { taskId: string; enabled: boolean; prompt: string }) => void;
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
        <span>{props.statsText}</span>
        <input
          type="search"
          className="eval-search"
          placeholder="Search tasks…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="eval-catalog-layout">
        <table className="eval-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Baseline</th>
              <th>Judge</th>
              <th>On</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((task) => (
              <tr
                key={task.id}
                className={
                  props.selectedTaskId === task.id ? "is-selected" : undefined
                }
                onClick={() => props.onSelectTask(task.id)}
              >
                <td>{task.id}</td>
                <td>{task.title}</td>
                <td>{task.baselineIncluded ? "yes" : "no"}</td>
                <td>{task.hasJudge ? "yes" : "—"}</td>
                <td>{task.enabled ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <EvalTaskDetail
          detail={props.taskDetail}
          running={props.running}
          onRunTask={props.onRunTask}
          onSave={({ enabled, prompt }) =>
            props.onSaveOverride({
              taskId: props.taskDetail!.id,
              enabled,
              prompt,
            })
          }
          onClearOverride={props.onClearOverride}
          onOpenCatalog={props.onOpenCatalog}
        />
      </div>
    </div>
  );
}
