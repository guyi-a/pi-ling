import { describe, expect, it } from "vitest";

import { Type } from "../src/index.js";
import {
  ANTHROPIC_MODELS,
  streamAnthropic,
  type AnthropicRequest,
  type AnthropicStreamEvent,
} from "../src/providers/anthropic.js";

async function* events(values: AnthropicStreamEvent[]) {
  for (const value of values) {
    yield value;
  }
}

describe("Anthropic provider", () => {
  it("normalizes thinking, text, tools and usage", async () => {
    const model = ANTHROPIC_MODELS[0]!;
    let request: AnthropicRequest | undefined;
    const stream = streamAnthropic(
      model,
      {
        systemPrompt: "Be concise.",
        messages: [{ role: "user", content: "Use a tool", timestamp: 1 }],
        tools: [
          {
            name: "lookup",
            description: "Look up a value",
            parameters: Type.Object({ key: Type.String() }),
          },
        ],
      },
      { apiKey: "test", reasoning: "high" },
      async (value) => {
        request = value;
        return events([
          {
            type: "message_start",
            message: { usage: { input_tokens: 12 } },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "thinking", thinking: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: "Need lookup." },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "signature_delta", signature: "sig-1" },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "content_block_start",
            index: 1,
            content_block: { type: "text", text: "" },
          },
          {
            type: "content_block_delta",
            index: 1,
            delta: { type: "text_delta", text: "Checking." },
          },
          { type: "content_block_stop", index: 1 },
          {
            type: "content_block_start",
            index: 2,
            content_block: {
              type: "tool_use",
              id: "tool-1",
              name: "lookup",
              input: {},
            },
          },
          {
            type: "content_block_delta",
            index: 2,
            delta: {
              type: "input_json_delta",
              partial_json: '{"key":"value"}',
            },
          },
          { type: "content_block_stop", index: 2 },
          {
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 9 },
          },
          { type: "message_stop" },
        ]);
      },
    );

    const types: string[] = [];
    for await (const event of stream) {
      types.push(event.type);
    }
    const result = await stream.result();

    expect(request).toMatchObject({
      model: "claude-sonnet-4-6",
      system: "Be concise.",
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
    });
    expect(types).toContain("thinking_delta");
    expect(types).toContain("text_delta");
    expect(types).toContain("toolcall_delta");
    expect(result.stopReason).toBe("toolUse");
    expect(result.usage).toMatchObject({ input: 12, output: 9 });
    expect(result.content).toEqual([
      {
        type: "thinking",
        thinking: "Need lookup.",
        signature: "sig-1",
      },
      { type: "text", text: "Checking." },
      {
        type: "toolCall",
        id: "tool-1",
        name: "lookup",
        arguments: { key: "value" },
      },
    ]);
  });

  it("turns transport failures into terminal events", async () => {
    const stream = streamAnthropic(
      ANTHROPIC_MODELS[0]!,
      { messages: [] },
      { apiKey: "test" },
      async () => {
        throw new Error("network failed");
      },
    );

    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("network failed");
  });
});
