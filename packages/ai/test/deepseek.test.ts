import { describe, expect, it } from "vitest";

import { Type } from "../src/index.js";
import {
  DEEPSEEK_MODELS,
  streamDeepSeek,
  type DeepSeekChunk,
  type DeepSeekRequest,
} from "../src/providers/deepseek.js";

async function* chunks(values: DeepSeekChunk[]) {
  for (const value of values) {
    yield value;
  }
}

describe("DeepSeek provider", () => {
  it("normalizes thinking, text, tool calls and usage", async () => {
    const model = DEEPSEEK_MODELS[0]!;
    let request: DeepSeekRequest | undefined;
    const stream = streamDeepSeek(
      model,
      {
        systemPrompt: "Be concise.",
        messages: [
          { role: "user", content: "Check the weather", timestamp: 1 },
        ],
        tools: [
          {
            name: "weather",
            description: "Get weather",
            parameters: Type.Object({ city: Type.String() }),
          },
        ],
      },
      { apiKey: "test", reasoning: "high" },
      async (value) => {
        request = value;
        return chunks([
          {
            choices: [
              { delta: { reasoning_content: "Need a tool. " } },
            ],
          },
          { choices: [{ delta: { content: "Checking." } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      function: {
                        name: "weather",
                        arguments: '{"city":',
                      },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '"Beijing"}' } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 8,
              completion_tokens_details: { reasoning_tokens: 3 },
            },
          },
        ]);
      },
    );

    const types: string[] = [];
    for await (const event of stream) {
      types.push(event.type);
    }
    const result = await stream.result();

    expect(request).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
    expect(types).toContain("thinking_delta");
    expect(types).toContain("text_delta");
    expect(types).toContain("toolcall_delta");
    expect(result.stopReason).toBe("toolUse");
    expect(result.usage).toMatchObject({
      input: 20,
      output: 8,
      reasoning: 3,
    });
    expect(result.content).toEqual([
      { type: "thinking", thinking: "Need a tool. " },
      { type: "text", text: "Checking." },
      {
        type: "toolCall",
        id: "call-1",
        name: "weather",
        arguments: { city: "Beijing" },
      },
    ]);
  });

  it("turns aborted requests into terminal error events", async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = streamDeepSeek(
      DEEPSEEK_MODELS[0]!,
      { messages: [] },
      { apiKey: "test", signal: controller.signal },
      async () => {
        throw new Error("request aborted");
      },
    );

    const result = await stream.result();
    expect(result.stopReason).toBe("aborted");
  });
});
