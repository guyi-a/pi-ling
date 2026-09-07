import { Session, SessionId } from "@deepseek-ai/dsh-session";
import type { CanonicalMessage } from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import { toDshSeed } from "../src/index.js";

const projection = { provider: "pi-ling-deepseek", model: "deepseek-v4-flash" };

const textOnlyHistory: CanonicalMessage[] = [
  {
    id: "canonical-user-1",
    role: "user",
    sourceRuntime: "native",
    createdAt: 1,
    content: [{ type: "text", text: "My test code is ORANGE-42." }],
  },
  {
    id: "canonical-assistant-1",
    role: "assistant",
    sourceRuntime: "native",
    createdAt: 1,
    content: [{ type: "text", text: "I will remember that code." }],
  },
];

const toolHistory: CanonicalMessage[] = [
  {
    id: "canonical-user-2",
    role: "user",
    sourceRuntime: "native",
    createdAt: 1,
    content: [{ type: "text", text: "Create a.txt." }],
  },
  {
    id: "canonical-assistant-2",
    role: "assistant",
    sourceRuntime: "native",
    createdAt: 1,
    content: [
      { type: "reasoning", text: "I will write the file." },
      { type: "text", text: "Sure." },
      {
        type: "tool-call",
        toolCallId: "call-1",
        name: "write",
        input: { path: "a.txt", content: "hello" },
      },
    ],
  },
  {
    id: "canonical-tool-1",
    role: "tool",
    sourceRuntime: "native",
    createdAt: 1,
    content: [
      { type: "tool-result", toolCallId: "call-1", content: "ok", isError: false },
    ],
  },
  {
    id: "canonical-assistant-3",
    role: "assistant",
    sourceRuntime: "native",
    createdAt: 1,
    content: [{ type: "text", text: "Done." }],
  },
];

describe("DSH transcript seed plugin", () => {
  it("projects canonical text-only messages onto the DSH model surface", () => {
    const session = Session.create(
      SessionId("seed-projection"),
      toDshSeed(textOnlyHistory, projection, 1),
    );
    expect(
      session.deriveMessages().map((message) => ({
        id: message.id,
        role: message.role,
        text:
          message.content[0]?.type === "text"
            ? message.content[0].text
            : "",
      })),
    ).toEqual([
      {
        id: "canonical-user-1",
        role: "user",
        text: "My test code is ORANGE-42.",
      },
      {
        id: "canonical-assistant-1",
        role: "assistant",
        text: "I will remember that code.",
      },
    ]);
  });

  it("projects tool-call and reasoning history preserving block structure", () => {
    const session = Session.create(
      SessionId("seed-tool-projection"),
      toDshSeed(toolHistory, projection, 1),
    );
    const derived = session.deriveMessages();
    expect(derived.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    const assistant = derived[1];
    expect(assistant?.role).toBe("assistant");
    const blocks = assistant?.content ?? [];
    expect(blocks.map((block) => block.type)).toEqual([
      "reasoning",
      "text",
      "tool-call",
    ]);
    const toolCall = blocks[2];
    expect(toolCall?.type).toBe("tool-call");
    if (toolCall?.type === "tool-call") {
      expect(toolCall.id).toBe("call-1");
      expect(toolCall.name).toBe("write");
      expect(JSON.parse(toolCall.arguments)).toEqual({
        path: "a.txt",
        content: "hello",
      });
    }
    const toolResult = derived[2];
    expect(toolResult?.role).toBe("user");
    const resultBlock = toolResult?.content[0];
    expect(resultBlock?.type).toBe("tool-result");
    if (resultBlock?.type === "tool-result") {
      expect(resultBlock.toolCallId).toBe("call-1");
      expect(resultBlock.isError).toBe(false);
    }
    const finalAssistant = derived[3];
    const finalText = finalAssistant?.content[0];
    expect(finalText?.type).toBe("text");
    if (finalText?.type === "text") expect(finalText.text).toBe("Done.");
  });

  it("rejects a tool message with no tool-result block", () => {
    expect(() =>
      toDshSeed(
        [
          {
            id: "user",
            role: "user",
            sourceRuntime: "native",
            createdAt: 1,
            content: [{ type: "text", text: "hi" }],
          },
          {
            id: "tool",
            role: "tool",
            sourceRuntime: "native",
            createdAt: 1,
            content: [{ type: "text", text: "not a result" }],
          },
        ],
        projection,
      ),
    ).toThrow();
  });

  it("appends a delta with contiguous seq and turn offsets", () => {
    const seed = toDshSeed(textOnlyHistory, projection, 1);
    const delta = toDshSeed(
      [
        {
          id: "canonical-user-2",
          role: "user",
          sourceRuntime: "native",
          createdAt: 1,
          content: [{ type: "text", text: "Second question." }],
        },
        {
          id: "canonical-assistant-2",
          role: "assistant",
          sourceRuntime: "native",
          createdAt: 1,
          content: [{ type: "text", text: "Second answer." }],
        },
      ],
      projection,
      1,
      { startTurn: 2, startSeq: seed.length },
    );
    expect(delta[0]?.seq).toBe(seed.length);
    const merged = Session.create(SessionId("seed-delta"), [...seed, ...delta]);
    expect(merged.deriveMessages().map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    const last = merged.deriveMessages().at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.content[0]?.type).toBe("text");
    if (last?.content[0]?.type === "text") {
      expect(last.content[0].text).toBe("Second answer.");
    }
  });
});
