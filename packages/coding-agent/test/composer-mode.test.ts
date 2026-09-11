import { describe, expect, it } from "vitest";

import {
  isEffectAllowedInComposerMode,
  toolsForComposerMode,
  wrapPromptForComposerMode,
} from "../src/composer-mode.js";
import { createAskUserTool } from "../src/tools/ask-user.js";
import { QuestionManager } from "../src/question/question-manager.js";
import { createBuiltinTools } from "../src/tools/builtins.js";

function toolNames(mode: "plan" | "ask" | "agent"): string[] {
  const tools = createBuiltinTools({
    workspace: {
      root: "/tmp",
      readText: async () => "",
      list: async () => [],
      grep: async () => [],
      glob: async () => [],
      readImage: async () => ({
        data: "",
        mimeType: "image/png",
        size: 0,
      }),
      writeText: async () => {},
      editText: async () => {},
      deleteFile: async () => {},
    } as never,
    changes: { capture: async () => {} },
  });
  return toolsForComposerMode(tools, mode).map((tool) => tool.name).sort();
}

describe("composer-mode", () => {
  it("filters tools for plan and ask modes", () => {
    const agentTools = toolNames("agent");
    const planTools = toolNames("plan");
    const askTools = toolNames("ask");

    expect(agentTools).toContain("write_file");
    expect(agentTools).toContain("todo_write");
    expect(planTools).toContain("create_plan");
    expect(planTools).not.toContain("write_file");
    expect(planTools).not.toContain("todo_write");
    expect(askTools).toContain("read_file");
    expect(askTools).not.toContain("create_plan");
    expect(askTools).not.toContain("run_command");
  });

  it("keeps ask_user available in every composer mode", () => {
    const manager = new QuestionManager(() => {});
    const askUser = createAskUserTool(manager, () => null);
    const tools = [
      ...createBuiltinTools({
        workspace: {
          root: "/tmp",
          readText: async () => "",
          list: async () => [],
          grep: async () => [],
          glob: async () => [],
          readImage: async () => ({
            data: "",
            mimeType: "image/png",
            size: 0,
          }),
          writeText: async () => {},
          editText: async () => {},
          deleteFile: async () => {},
        } as never,
        changes: { capture: async () => {} },
      }),
      askUser,
    ];
    for (const mode of ["plan", "ask", "agent"] as const) {
      expect(
        toolsForComposerMode(tools, mode).some((tool) => tool.name === "ask_user"),
      ).toBe(true);
    }
  });

  it("wraps user prompts with the active composer mode", () => {
    expect(wrapPromptForComposerMode("hello", "agent")).toBe("hello");
    expect(wrapPromptForComposerMode("hello", "plan")).toContain(
      "[Composer mode: Plan]",
    );
    expect(wrapPromptForComposerMode("hello", "ask")).toContain(
      "[Composer mode: Ask]",
    );
  });

  it("blocks write effects outside agent mode", () => {
    expect(
      isEffectAllowedInComposerMode("ask", {
        kind: "filesystem-write",
        operation: "write",
        path: "a.txt",
        scope: "workspace",
      }),
    ).toBe(false);
    expect(
      isEffectAllowedInComposerMode("plan", {
        kind: "meta",
        operation: "plan",
      }),
    ).toBe(true);
    expect(
      isEffectAllowedInComposerMode("plan", {
        kind: "meta",
        operation: "todo",
      }),
    ).toBe(false);
    expect(
      isEffectAllowedInComposerMode("ask", {
        kind: "meta",
        operation: "question",
      }),
    ).toBe(true);
    expect(
      isEffectAllowedInComposerMode("ask", {
        kind: "meta",
        operation: "skill",
      }),
    ).toBe(true);
    expect(
      isEffectAllowedInComposerMode("plan", {
        kind: "meta",
        operation: "skill",
      }),
    ).toBe(true);
  });
});
