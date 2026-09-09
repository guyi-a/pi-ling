import type { ToolTimelineItem } from "../../../timeline/reducer";
import { todoStatusGlyph } from "../../../run-activity/project-run-todos";
import { stringListArg, ToolCardShell } from "./tool-card-shell";

type StructuredTodo = {
  id: string;
  content: string;
  status: string;
};

function structuredTodos(arguments_: Record<string, unknown>): StructuredTodo[] {
  const raw = arguments_.todos;
  if (!Array.isArray(raw)) return [];
  const items: StructuredTodo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const content = typeof record.content === "string" ? record.content : "";
    const status = typeof record.status === "string" ? record.status : "pending";
    if (!id || !content) continue;
    items.push({ id, content, status });
  }
  return items;
}

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
  const structured = structuredTodos(props.item.arguments);
  const items = structured.length > 0 ? [] : todoItems(props.item.arguments);

  return (
    <ToolCardShell
      item={props.item}
      defaultOpen={false}
      keepCollapsed
      disableExpand={structured.length === 0 && items.length === 0}
    >
      {structured.length > 0 ? (
        <ul className="tool-todo-list">
          {structured.map((todo) => (
            <li
              className={`tool-todo-item tool-todo-item-${todo.status}`}
              key={todo.id}
            >
              <span className="tool-todo-glyph" aria-hidden="true">
                {todoStatusGlyph(
                  todo.status as
                    | "pending"
                    | "in_progress"
                    | "completed"
                    | "cancelled",
                )}
              </span>
              {todo.content}
            </li>
          ))}
        </ul>
      ) : items.length > 0 ? (
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
