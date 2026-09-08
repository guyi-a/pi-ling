import type { ToolTimelineItem } from "../../../timeline/reducer";
import { stringListArg, ToolCardShell } from "./tool-card-shell";

function todoItems(arguments_: Record<string, unknown>): string[] {
  const direct = stringListArg(arguments_, "todos", "items", "tasks");
  if (direct.length > 0) return direct;
  const content = arguments_["content"];
  if (typeof content === "string" && content.trim()) {
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

export function TodoToolCard(props: { item: ToolTimelineItem }) {
  const items = todoItems(props.item.arguments);
  return (
    <ToolCardShell item={props.item}>
      {items.length > 0 ? (
        <ul className="tool-todo-list">
          {items.map((item, index) => (
            <li key={`${index}:${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="tool-rich-empty">No todo items in tool arguments.</p>
      )}
    </ToolCardShell>
  );
}
