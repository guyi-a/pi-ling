import type { ToolTimelineItem } from "../../../timeline/reducer";
import { ToolCardShell } from "./tool-card-shell";

function subagentSummary(arguments_: Record<string, unknown>): {
  title: string;
  detail?: string;
} {
  const title =
    (typeof arguments_["task"] === "string" && arguments_["task"]) ||
    (typeof arguments_["prompt"] === "string" && arguments_["prompt"]) ||
    (typeof arguments_["description"] === "string" &&
      arguments_["description"]) ||
    (typeof arguments_["message"] === "string" && arguments_["message"]) ||
    "Subagent task";
  const detail =
    typeof arguments_["agent_name"] === "string"
      ? arguments_["agent_name"]
      : typeof arguments_["name"] === "string"
        ? arguments_["name"]
        : undefined;
  return { title: title.trim(), ...(detail ? { detail } : {}) };
}

export function SubagentToolCard(props: { item: ToolTimelineItem }) {
  const summary = subagentSummary(props.item.arguments);
  const output =
    typeof props.item.output === "string" ? props.item.output.trim() : "";

  return (
    <ToolCardShell item={props.item} defaultOpen={Boolean(output)}>
      <div className="tool-subagent-body">
        <p className="tool-subagent-task">{summary.title}</p>
        {summary.detail ? (
          <p className="tool-subagent-agent">{summary.detail}</p>
        ) : null}
        {output ? (
          <pre className="tool-subagent-output">{output.slice(0, 400)}</pre>
        ) : null}
      </div>
    </ToolCardShell>
  );
}
