import { describe, expect, it } from "vitest";

import {
  activityPresentationRunIds,
  chunkDelay,
  immediatePresentationRunIds,
  operationDwell,
  pendingPresentationUnits,
  splitPresentationChunks,
} from "./use-message-presentation";

describe("message presentation", () => {
  it("releases phrases instead of individual characters", () => {
    const source =
      "先检查会话存储的结构，然后修改实现并运行测试。";
    const chunks = splitPresentationChunks(source);
    expect(chunks.join("")).toBe(source);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length > 1)).toBe(true);
  });

  it("keeps fenced code stable as one presentation chunk", () => {
    const code = "```ts\nconst value = 1;\n```";
    expect(splitPresentationChunks(code)).toEqual([code]);
  });

  it("adapts operation and text pacing to backlog", () => {
    expect(operationDwell(1)).toBe(450);
    expect(operationDwell(9)).toBe(240);
    expect(chunkDelay(4)).toBe(55);
    expect(chunkDelay(50)).toBe(24);
  });

  it("keeps tool operations ahead of the later final message", () => {
    const units = pendingPresentationUnits({
      items: [
        {
          kind: "tool",
          id: "tool",
          runId: "run",
          turnId: "turn",
          createdSeq: 2,
          callId: "tool",
          tool: "read_file",
          arguments: { path: "a.ts" },
          status: "completed",
        },
        {
          kind: "assistant",
          id: "final",
          runId: "run",
          turnId: "final-turn",
          createdSeq: 4,
          text: "done",
          thinking: "",
          status: "completed",
          stopReason: "stop",
        },
      ],
      liveMessageIds: new Set(["final"]),
      revealedChunks: {},
      visibleToolIds: new Set(),
    });
    expect(units.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      "tool:tool",
      "message:final",
    ]);
  });

  it("settles activity when the first final text chunk appears", () => {
    const message = {
      kind: "message" as const,
      id: "final",
      runId: "run",
      createdSeq: 4,
    };
    expect(
      activityPresentationRunIds([message], message, {}),
    ).toEqual(new Set(["run"]));
    expect(
      activityPresentationRunIds(
        [message],
        message,
        { final: 1 },
      ),
    ).toEqual(new Set());

    const tool = {
      kind: "tool" as const,
      id: "tool",
      runId: "run",
      createdSeq: 3,
    };
    expect(
      activityPresentationRunIds([], tool, { final: 1 }),
    ).toEqual(new Set(["run"]));
  });

  it("fast-forwards blocking approval and terminal failures", () => {
    const approvalRunIds = immediatePresentationRunIds(
      [
        {
          kind: "approval",
          id: "approval",
          runId: "approval-run",
          turnId: "turn",
          createdSeq: 1,
          toolItemId: "tool",
          status: "pending",
          approval: {
            callId: "tool",
            tool: "write_file",
            arguments: {},
            effect: { kind: "filesystem-write" },
            effectDigest: "digest",
            reason: "write",
          },
        },
        {
          kind: "tool",
          id: "tool",
          runId: "approval-run",
          turnId: "turn",
          createdSeq: 2,
          callId: "tool",
          tool: "pwsh",
          arguments: { command: "pnpm test" },
          status: "awaiting-approval",
        },
      ],
      {
        "failed-run": { id: "failed-run", status: "error" },
        "active-run": { id: "active-run", status: "running" },
      },
    );
    expect([...approvalRunIds]).toEqual([
      "approval-run",
      "failed-run",
    ]);
  });

  it("queues resumed assistant text after approval fast-forward", () => {
    const units = pendingPresentationUnits({
      items: [
        {
          kind: "assistant",
          id: "assistant",
          runId: "run",
          turnId: "turn",
          createdSeq: 3,
          text: "Before tool.\nAfter approval.",
          thinking: "",
          status: "completed",
          stopReason: "stop",
        },
      ],
      liveMessageIds: new Set(["assistant"]),
      revealedChunks: { assistant: 1 },
      visibleToolIds: new Set(),
    });
    expect(units).toEqual([
      {
        kind: "message",
        id: "assistant",
        runId: "run",
        createdSeq: 3,
      },
    ]);
  });
});
