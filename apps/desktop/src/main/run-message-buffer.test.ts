import { afterEach, describe, expect, it, vi } from "vitest";

import { RunMessageBuffer } from "./run-message-buffer.js";

describe("RunMessageBuffer", () => {
  afterEach(() => vi.useRealTimers());

  it("merges adjacent deltas within one frame window", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const buffer = new RunMessageBuffer((frame) => {
      if ("delta" in frame.frame) emitted.push(frame.frame.delta);
    });
    const base = {
      sessionId: "session",
      runId: "run",
      messageId: "message",
      turnId: "turn",
      emittedAt: 1,
    };
    buffer.ingest({
      ...base,
      frame: { kind: "assistant.text.delta", delta: "hel" },
    });
    buffer.ingest({
      ...base,
      emittedAt: 2,
      frame: { kind: "assistant.text.delta", delta: "lo" },
    });
    vi.advanceTimersByTime(16);
    expect(emitted).toEqual(["hello"]);
    expect(buffer.snapshot("session")).toHaveLength(1);
  });

  it("isolates sessions and removes committed message frames", () => {
    const buffer = new RunMessageBuffer(() => {}, { mergeWindowMs: 0 });
    buffer.ingest({
      sessionId: "a",
      runId: "run",
      messageId: "a-message",
      emittedAt: 1,
      frame: { kind: "assistant.text.delta", delta: "a" },
    });
    buffer.ingest({
      sessionId: "b",
      runId: "run",
      messageId: "b-message",
      emittedAt: 2,
      frame: { kind: "assistant.text.delta", delta: "b" },
    });
    expect(buffer.snapshot("a")).toHaveLength(1);
    expect(buffer.snapshot("b")).toHaveLength(1);
    buffer.commitMessage("a", "run", "a-message");
    expect(buffer.snapshot("a")).toEqual([]);
    expect(buffer.snapshot("b")).toHaveLength(1);
    buffer.dispose();
  });

  it("flushes and releases a completed run", () => {
    const emitted: string[] = [];
    const buffer = new RunMessageBuffer((frame) => {
      if ("delta" in frame.frame) emitted.push(frame.frame.delta);
    });
    buffer.ingest({
      sessionId: "session",
      runId: "run",
      messageId: "message",
      emittedAt: 1,
      frame: { kind: "assistant.reasoning.delta", delta: "thinking" },
    });
    buffer.endRun("session", "run");
    expect(emitted).toEqual(["thinking"]);
    expect(buffer.snapshot("session")).toEqual([]);
  });
});
