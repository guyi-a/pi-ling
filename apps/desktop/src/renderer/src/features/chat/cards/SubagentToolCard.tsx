import type { BackgroundTaskStatus } from "@pi-ling/contracts";

import {
  subagentDescription,
  subagentToolPresentation,
} from "../../../run-activity/tool-taxonomy";
import type { ToolTimelineItem } from "../../../timeline/reducer";
import { useBackgroundTask } from "../background-tasks-context";
import { ToolCardShell } from "./tool-card-shell";

function subagentSummary(arguments_: Record<string, unknown>): {
  title: string;
  detail?: string;
  background: boolean;
} {
  const title =
    (typeof arguments_["description"] === "string" &&
      arguments_["description"]) ||
    (typeof arguments_["task"] === "string" && arguments_["task"]) ||
    (typeof arguments_["prompt"] === "string" && arguments_["prompt"]) ||
    (typeof arguments_["message"] === "string" && arguments_["message"]) ||
    "Subagent task";
  const detail =
    typeof arguments_["subagent_type"] === "string"
      ? arguments_["subagent_type"]
      : typeof arguments_["agent_name"] === "string"
        ? arguments_["agent_name"]
        : typeof arguments_["name"] === "string"
          ? arguments_["name"]
          : undefined;
  return {
    title: title.trim(),
    ...(detail ? { detail } : {}),
    background: arguments_["run_in_background"] === true,
  };
}

function parseToolOutput(output: string): {
  taskId?: string;
  status?: BackgroundTaskStatus | "pending" | "running";
  summary?: string;
  mode?: string;
} {
  try {
    return JSON.parse(output) as {
      taskId?: string;
      status?: BackgroundTaskStatus | "pending" | "running";
      summary?: string;
      mode?: string;
    };
  } catch {
    return {};
  }
}

const statusLabel: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export function SubagentToolCard(props: { item: ToolTimelineItem }) {
  const summary = subagentSummary(props.item.arguments);
  const output =
    typeof props.item.output === "string" ? props.item.output.trim() : "";
  const parsed = parseToolOutput(output);
  const backgroundTask = useBackgroundTask(props.item.callId);
  const isBackground = summary.background || parsed.mode === "background";
  const taskStatus = backgroundTask?.status ?? parsed.status;
  const taskId = backgroundTask?.id ?? parsed.taskId;
  const resultText =
    backgroundTask?.summary ??
    backgroundTask?.error ??
    parsed.summary ??
    (isBackground && taskStatus === "completed" ? output : "");
  const resolvedTaskStatus: BackgroundTaskStatus | undefined =
    backgroundTask?.status ??
    (taskStatus === "pending" ||
    taskStatus === "running" ||
    taskStatus === "completed" ||
    taskStatus === "failed" ||
    taskStatus === "cancelled" ||
    taskStatus === "interrupted"
      ? taskStatus
      : undefined);
  const presentation = subagentToolPresentation(
    props.item,
    resolvedTaskStatus,
  );

  return (
    <ToolCardShell
      item={props.item}
      hideRawDetails
      label={presentation.label}
      target={presentation.target}
      statusText={presentation.statusText}
    >
      <div className="tool-subagent-body">
        <p className="tool-subagent-task">{subagentDescription(props.item.arguments)}</p>
        {summary.detail ? (
          <p className="tool-subagent-agent">{summary.detail}</p>
        ) : null}
        {isBackground ? (
          <div className="tool-subagent-meta">
            {taskId ? (
              <span className="tool-subagent-task-id">Task {taskId.slice(0, 8)}</span>
            ) : null}
            {taskStatus ? (
              <span className={`tool-subagent-status status-${taskStatus}`}>
                {statusLabel[taskStatus] ?? taskStatus}
              </span>
            ) : null}
          </div>
        ) : null}
        {resultText ? (
          <pre className="tool-subagent-output">{resultText.slice(0, 400)}</pre>
        ) : null}
      </div>
    </ToolCardShell>
  );
}
