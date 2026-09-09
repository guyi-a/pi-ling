import { describe, expect, it } from "vitest";

import type { ToolTimelineItem } from "../timeline/reducer";
import {
  projectRunTodos,
  runTodoSummary,
} from "./project-run-todos";

function todoTool(
  overrides: Partial<ToolTimelineItem> & Pick<ToolTimelineItem, "callId" | "runId">,
): ToolTimelineItem {
  return {
    id: overrides.id ?? overrides.callId,
    kind: "tool",
    turnId: "turn-1",
    tool: "todo_write",
    arguments: { merge: false, todos: [] },
    status: "completed",
    createdSeq: 1,
    ...overrides,
  };
}

describe("project-run-todos", () => {
  it("merges todo updates by id", () => {
    const snapshot = projectRunTodos(
      [
        todoTool({
          callId: "call-1",
          runId: "run-a",
          createdSeq: 1,
          arguments: {
            merge: false,
            todos: [
              { id: "a", content: "First", status: "pending" },
              { id: "b", content: "Second", status: "pending" },
            ],
          },
        }),
        todoTool({
          callId: "call-2",
          runId: "run-a",
          createdSeq: 2,
          arguments: {
            merge: true,
            todos: [{ id: "a", content: "First", status: "completed" }],
          },
        }),
      ],
      "run-a",
    );

    expect(snapshot).toMatchObject({
      totalCount: 2,
      completedCount: 1,
      activeCount: 1,
    });
    expect(snapshot?.todos.find((todo) => todo.id === "a")?.status).toBe(
      "completed",
    );
  });

  it("formats completed summary", () => {
    expect(
      runTodoSummary({
        todos: [
          { id: "a", content: "A", status: "completed" },
          { id: "b", content: "B", status: "completed" },
        ],
        completedCount: 2,
        activeCount: 0,
        totalCount: 2,
      }),
    ).toBe("2 of 2 To-dos Completed");
  });

  it("formats in-progress summary", () => {
    expect(
      runTodoSummary({
        todos: [
          { id: "a", content: "A", status: "completed" },
          { id: "b", content: "B", status: "in_progress" },
          { id: "c", content: "C", status: "pending" },
        ],
        completedCount: 1,
        activeCount: 2,
        totalCount: 3,
        inProgress: { id: "b", content: "B", status: "in_progress" },
      }),
    ).toBe("2 of 3 To-dos");
  });
});
