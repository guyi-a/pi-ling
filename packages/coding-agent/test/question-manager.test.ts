import { describe, expect, it, vi } from "vitest";

import { QuestionManager } from "../src/question/question-manager.js";

describe("QuestionManager", () => {
  it("waits until resolve returns answers", async () => {
    const onRequest = vi.fn();
    const manager = new QuestionManager(onRequest);
    const answersPromise = manager.wait(
      { runId: "run-1", turnId: "turn-1" },
      "call-1",
      [{ id: "mode", question: "Which mode?" }],
      new AbortController().signal,
    );
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(manager.resolve("call-1", [{ id: "mode", selected: ["Agent"] }])).toBe(
      true,
    );
    await expect(answersPromise).resolves.toEqual([
      { id: "mode", selected: ["Agent"] },
    ]);
  });

  it("rejects when cancelled", async () => {
    const manager = new QuestionManager(() => {});
    const controller = new AbortController();
    const answersPromise = manager.wait(
      { runId: "run-1", turnId: "turn-1" },
      "call-1",
      [{ id: "mode", question: "Which mode?" }],
      controller.signal,
    );
    manager.cancelAll();
    await expect(answersPromise).rejects.toThrow(
      "ask_user was aborted before the user answered",
    );
  });

  it("restores pending questions", async () => {
    const manager = new QuestionManager(() => {});
    manager.restore({
      runId: "run-1",
      turnId: "turn-1",
      callId: "call-1",
      questions: [{ id: "mode", question: "Which mode?" }],
    });
    expect(manager.list()).toHaveLength(1);
    expect(manager.resolve("call-1", [{ id: "mode", selected: [] }])).toBe(true);
  });
});
