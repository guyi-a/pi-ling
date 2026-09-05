import { describe, expect, it } from "vitest";

import {
  AssistantMessageEventStream,
  createAssistantMessage,
  createModels,
  type Model,
  type Provider,
} from "../src/index.js";

const model: Model = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "deepseek",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

describe("AI protocol", () => {
  it("iterates events and resolves the terminal result", async () => {
    const stream = new AssistantMessageEventStream();
    const message = createAssistantMessage(model);
    message.stopReason = "stop";

    queueMicrotask(() => {
      stream.push({ type: "start", partial: message });
      stream.push({ type: "done", reason: "stop", message });
    });

    const eventTypes: string[] = [];
    for await (const event of stream) {
      eventTypes.push(event.type);
    }

    expect(eventTypes).toEqual(["start", "done"]);
    expect(await stream.result()).toBe(message);
  });

  it("resolves provider auth before dispatch", async () => {
    const previous = process.env["DEEPSEEK_API_KEY"];
    process.env["DEEPSEEK_API_KEY"] = "test-key";
    let receivedKey = "";

    const provider: Provider = {
      id: "deepseek",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      models: [model],
      stream: (_model, _context, options) => {
        receivedKey = options.apiKey;
        const stream = new AssistantMessageEventStream();
        const message = createAssistantMessage(model);
        message.stopReason = "stop";
        queueMicrotask(() =>
          stream.push({ type: "done", reason: "stop", message }),
        );
        return stream;
      },
    };

    try {
      const models = createModels([provider]);
      const stream = models.stream(model, { messages: [] });
      await stream.result();
      expect(receivedKey).toBe("test-key");
    } finally {
      if (previous === undefined) {
        delete process.env["DEEPSEEK_API_KEY"];
      } else {
        process.env["DEEPSEEK_API_KEY"] = previous;
      }
    }
  });
});
