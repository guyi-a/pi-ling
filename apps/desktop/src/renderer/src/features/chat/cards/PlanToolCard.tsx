import type { ToolTimelineItem } from "../../../timeline/reducer";
import { extractPlanText } from "../../plans/project-session-plans";
import { Markdown } from "../Markdown";
import { ToolCardShell } from "./tool-card-shell";

export function PlanToolCard(props: { item: ToolTimelineItem }) {
  const planText = extractPlanText(props.item);

  return (
    <ToolCardShell
      item={props.item}
      defaultOpen={false}
      hideRawDetails={Boolean(planText)}
    >
      {planText ? (
        <div className="tool-plan-preview">
          <Markdown>{planText}</Markdown>
        </div>
      ) : null}
    </ToolCardShell>
  );
}
