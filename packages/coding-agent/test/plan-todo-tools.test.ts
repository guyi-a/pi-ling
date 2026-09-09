import { describe, expect, it } from "vitest";

import { createPlanTools, validateTodoWrite } from "../src/tools/meta-tools.js";
import { deriveEffect, approvalReason } from "../src/effects/effects.js";
import { Workspace } from "../src/workspace/workspace.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("plan and todo meta tools", () => {
  it("create_plan records plan text", async () => {
    const [createPlan] = createPlanTools();
    const result = await createPlan.execute!("call-1", {
      plan: "# Step one\nDo things",
    });
    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as { text: string }).text).toContain("Plan recorded");
  });

  it("update_plan accepts content alias", async () => {
    const [, updatePlan] = createPlanTools();
    const result = await updatePlan.execute!("call-2", {
      content: "Revised plan",
    });
    expect((result.content[0] as { text: string }).text).toContain("updated");
  });

  it("todo_write rejects multiple in_progress items", async () => {
    expect(
      validateTodoWrite([
        { id: "a", content: "One", status: "in_progress" },
        { id: "b", content: "Two", status: "in_progress" },
      ]),
    ).toContain("At most one");
  });

  it("todo_write executes valid todos", async () => {
    const [, , todoWrite] = createPlanTools();
    const result = await todoWrite.execute!("call-3", {
      merge: true,
      todos: [
        { id: "a", content: "First", status: "in_progress" },
        { id: "b", content: "Second", status: "pending" },
      ],
    });
    expect((result.content[0] as { text: string }).text).toContain("Updated 2 todo");
  });

  it("meta tools do not require approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-ling-meta-"));
    try {
      const workspace = await Workspace.open(root);
      await writeFile(join(root, "README.md"), "hello");
      for (const name of ["create_plan", "update_plan", "todo_write"] as const) {
        const effect = await deriveEffect(
          {
            type: "toolCall",
            id: name,
            name,
            arguments:
              name === "todo_write"
                ? {
                    merge: true,
                    todos: [{ id: "a", content: "x", status: "pending" }],
                  }
                : { plan: "Plan body" },
          },
          workspace,
        );
        expect(effect.kind).toBe("meta");
        expect(approvalReason(effect, "manual")).toBeUndefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
