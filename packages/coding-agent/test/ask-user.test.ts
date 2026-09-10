import { describe, expect, it } from "vitest";

import { QuestionManager } from "../src/question/question-manager.js";
import { createAskUserTool } from "../src/tools/ask-user.js";

describe("ask_user tool", () => {
  it("returns structured answers as JSON", async () => {
    const manager = new QuestionManager(() => {});
    const tool = createAskUserTool(manager, () => ({
      runId: "run-1",
      turnId: "turn-1",
    }));
    const executePromise = tool.execute(
      "call-1",
      {
        questions: [
          {
            id: "mode",
            question: "Which mode?",
            options: [{ label: "Agent" }, { label: "Plan" }],
          },
        ],
      } as never,
      new AbortController().signal,
    );
    expect(manager.resolve("call-1", [{ id: "mode", selected: ["Plan"] }])).toBe(
      true,
    );
    const result = await executePromise;
    expect(result.content[0]).toMatchObject({ type: "text" });
    const payload = JSON.parse(
      (result.content[0] as { type: "text"; text: string }).text,
    ) as { answers: Array<{ id: string; selected: string[] }> };
    expect(payload.answers).toEqual([{ id: "mode", selected: ["Plan"] }]);
  });

  it("surfaces user cancellation while waiting for answers", async () => {
    const manager = new QuestionManager(() => {});
    const tool = createAskUserTool(manager, () => ({
      runId: "run-1",
      turnId: "turn-1",
    }));
    const controller = new AbortController();
    const executePromise = tool.execute(
      "call-1",
      {
        questions: [{ id: "mode", question: "Which mode?" }],
      } as never,
      controller.signal,
    );
    manager.cancelAll("User cancelled before answering the question");
    controller.abort(new Error("Run cancelled by user"));
    await expect(executePromise).rejects.toThrow(
      "User cancelled before answering the question",
    );
  });
});
