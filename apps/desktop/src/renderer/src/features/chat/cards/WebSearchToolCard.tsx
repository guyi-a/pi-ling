import type { ToolTimelineItem } from "../../../timeline/reducer";
import { ToolCardShell } from "./tool-card-shell";

function searchQuery(arguments_: Record<string, unknown>): string {
  for (const key of [
    "search_term",
    "query",
    "q",
    "search",
    "search_query",
  ]) {
    const value = arguments_[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function WebSearchToolCard(props: { item: ToolTimelineItem }) {
  const query = searchQuery(props.item.arguments);
  const output =
    typeof props.item.output === "string" ? props.item.output.trim() : "";

  return (
    <ToolCardShell item={props.item}>
      <div className="tool-web-search-body">
        {query ? <p className="tool-web-search-query">{query}</p> : null}
        {output ? (
          <pre className="tool-web-search-output">{output.slice(0, 600)}</pre>
        ) : (
          <p className="tool-rich-empty">Waiting for search results…</p>
        )}
      </div>
    </ToolCardShell>
  );
}
