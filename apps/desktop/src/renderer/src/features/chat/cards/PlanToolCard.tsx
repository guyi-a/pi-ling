import type { ToolTimelineItem } from "../../../timeline/reducer";
import { ToolCardShell } from "./tool-card-shell";

function planText(item: ToolTimelineItem): string {
  const args = item.arguments;
  for (const key of ["plan", "content", "text", "body", "summary"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (typeof item.output === "string" && item.output.trim()) {
    return item.output.trim();
  }
  return "";
}

export function PlanToolCard(props: { item: ToolTimelineItem }) {
  const text = planText(props.item);
  const preview =
    text.length > 320 ? `${text.slice(0, 319)}…` : text;

  return (
    <ToolCardShell item={props.item} defaultOpen={Boolean(text)}>
      {text ? (
        <div className="tool-plan-body">
          <pre className="tool-plan-preview">{preview}</pre>
          {text.length > preview.length ? (
            <details className="tool-plan-details">
              <summary>查看完整方案</summary>
              <pre>{text}</pre>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="tool-rich-empty">No plan content available yet.</p>
      )}
    </ToolCardShell>
  );
}
