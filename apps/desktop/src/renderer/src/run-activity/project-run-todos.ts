import type { TimelineItem, ToolTimelineItem } from "../timeline/reducer";

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface RunTodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface RunTodoSnapshot {
  todos: RunTodoItem[];
  completedCount: number;
  activeCount: number;
  totalCount: number;
  inProgress?: RunTodoItem;
}

const TODO_TOOL_PATTERN = /todo_write|update_todo|todowrite/;

export function isTodoWriteTool(name: string): boolean {
  return TODO_TOOL_PATTERN.test(name.trim().toLowerCase());
}

function parseTodoItems(value: unknown): RunTodoItem[] {
  if (!Array.isArray(value)) return [];
  const items: RunTodoItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const content =
      typeof record.content === "string" ? record.content.trim() : "";
    const status = record.status;
    if (!id || !content) continue;
    if (
      status !== "pending" &&
      status !== "in_progress" &&
      status !== "completed" &&
      status !== "cancelled"
    ) {
      continue;
    }
    items.push({ id, content, status });
  }
  return items;
}

function applyTodoWrite(
  current: RunTodoItem[],
  incoming: RunTodoItem[],
  merge: boolean,
): RunTodoItem[] {
  if (!merge) return incoming;
  const byId = new Map(current.map((todo) => [todo.id, todo]));
  for (const todo of incoming) {
    byId.set(todo.id, todo);
  }
  return [...byId.values()];
}

export function projectRunTodos(
  items: readonly TimelineItem[],
  runId: string,
): RunTodoSnapshot | null {
  let todos: RunTodoItem[] = [];
  let sawTodoTool = false;

  const toolItems = items
    .filter(
      (item): item is ToolTimelineItem =>
        item.kind === "tool" &&
        item.runId === runId &&
        isTodoWriteTool(item.tool) &&
        item.status === "completed",
    )
    .sort((left, right) => left.createdSeq - right.createdSeq);

  for (const item of toolItems) {
    sawTodoTool = true;
    const parsed = parseTodoItems(item.arguments.todos);
    const merge = item.arguments.merge === true;
    todos = applyTodoWrite(todos, parsed, merge);
  }

  if (!sawTodoTool) return null;

  const completedCount = todos.filter(
    (todo) => todo.status === "completed",
  ).length;
  const activeCount = todos.filter(
    (todo) => todo.status === "pending" || todo.status === "in_progress",
  ).length;
  const inProgress = todos.find((todo) => todo.status === "in_progress");

  return {
    todos,
    completedCount,
    activeCount,
    totalCount: todos.length,
    ...(inProgress ? { inProgress } : {}),
  };
}

export function runTodoSummary(snapshot: RunTodoSnapshot): string {
  if (snapshot.totalCount === 0) return "0 To-dos";
  if (snapshot.activeCount === 0) {
    return `${snapshot.completedCount} of ${snapshot.totalCount} To-dos Completed`;
  }
  const progressed = snapshot.completedCount + (snapshot.inProgress ? 1 : 0);
  return `${progressed} of ${snapshot.totalCount} To-dos`;
}

export function todoStatusGlyph(status: TodoStatus): string {
  switch (status) {
    case "in_progress":
      return "●";
    case "completed":
      return "✓";
    case "cancelled":
      return "–";
    default:
      return "○";
  }
}
