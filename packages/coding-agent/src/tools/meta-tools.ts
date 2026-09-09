import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@pi-ling/agent-core";

export type TodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

const TodoStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("cancelled"),
]);

const TodoItemSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  content: Type.String(),
  status: TodoStatusSchema,
});

export function extractPlanText(arguments_: Record<string, unknown>): string {
  for (const key of ["plan", "content", "text", "body"]) {
    const value = arguments_[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function validateTodoWrite(todos: TodoItem[]): string | undefined {
  const inProgress = todos.filter((todo) => todo.status === "in_progress");
  if (inProgress.length > 1) {
    return "At most one todo may be in_progress";
  }
  for (const todo of todos) {
    if (!todo.id.trim()) return "Each todo requires a non-empty id";
  }
  return undefined;
}

export function formatTodosForModel(todos: TodoItem[]): string {
  if (todos.length === 0) return "Todo list cleared.";
  const lines = todos.map(
    (todo) => `- [${todo.status}] ${todo.id}: ${todo.content}`,
  );
  return `Updated ${todos.length} todo(s):\n${lines.join("\n")}`;
}

export function createPlanTools(): AgentTool[] {
  const planTextSchema = Type.Object({
    plan: Type.String({ minLength: 1 }),
  });

  const updatePlanSchema = Type.Object({
    plan: Type.Optional(Type.String({ minLength: 1 })),
    content: Type.Optional(Type.String({ minLength: 1 })),
  });

  const createPlan: AgentTool = {
    name: "create_plan",
    label: "Create plan",
    description:
      "Present a markdown implementation plan for user review in the Plans panel. After calling this, stop and wait for the user to Build before modifying files or running commands.",
    parameters: planTextSchema,
    execute: async (_callId, arguments_) => {
      const plan = extractPlanText(arguments_ as Record<string, unknown>);
      if (!plan) {
        throw new Error("plan is required");
      }
      return {
        content: [
          {
            type: "text",
            text: "Plan recorded for user review. Wait for Build before executing.",
          },
        ],
      };
    },
  };

  const updatePlan: AgentTool = {
    name: "update_plan",
    label: "Update plan",
    description:
      "Revise the markdown plan during the same planning run before the user Builds.",
    parameters: updatePlanSchema,
    execute: async (_callId, arguments_) => {
      const plan = extractPlanText(arguments_ as Record<string, unknown>);
      if (!plan) {
        throw new Error("plan or content is required");
      }
      return {
        content: [{ type: "text", text: "Plan updated for user review." }],
      };
    },
  };

  const todoWrite: AgentTool = {
    name: "todo_write",
    label: "Todo write",
    description:
      "Create or update the task checklist for the current execution run. Use merge=true to update items by id; merge=false replaces the whole list. Keep at most one item in_progress.",
    parameters: Type.Object({
      merge: Type.Boolean({
        description:
          "true merges by id into the existing list; false replaces the whole list",
      }),
      todos: Type.Array(TodoItemSchema, {
        description: "Todo items to write or merge",
      }),
    }),
    execute: async (_callId, arguments_) => {
      const { merge, todos } = arguments_ as {
        merge: boolean;
        todos: TodoItem[];
      };
      const error = validateTodoWrite(todos);
      if (error) {
        throw new Error(error);
      }
      return {
        content: [
          {
            type: "text",
            text: formatTodosForModel(todos),
          },
        ],
      };
    },
  };

  return [createPlan, updatePlan, todoWrite];
}
