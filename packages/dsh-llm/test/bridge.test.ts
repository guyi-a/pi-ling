import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import { describe, expect, it } from "vitest";

import { toPiContext } from "../src/index.js";

describe("DSH LLM bridge", () => {
  it("maps DSH text and tool history into pi-ling AI context", () => {
    const options = {
      provider: "pi-ling-deepseek",
      model: "deepseek-v4-flash",
      system: "system",
      messages: [
        {
          id: "user-1",
          role: "user",
          source: { kind: "user" },
          content: [{ type: "text", text: "hello" }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          source: {
            kind: "model",
            provider: "pi-ling-deepseek",
            model: "deepseek-v4-flash",
          },
          content: [
            {
              type: "tool-call",
              id: "call-1",
              name: "read_file",
              arguments: '{"path":"a.txt"}',
            },
          ],
        },
        {
          id: "tool-1",
          role: "user",
          source: { kind: "tool", callId: "call-1" },
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              content: [{ type: "text", text: "contents" }],
              isError: false,
            },
          ],
        },
      ],
    } as unknown as GenerateOptions;

    expect(toPiContext(options)).toMatchObject({
      systemPrompt: "system",
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "read_file",
              arguments: { path: "a.txt" },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read_file",
          content: [{ type: "text", text: "contents" }],
        },
      ],
    });
  });
});
