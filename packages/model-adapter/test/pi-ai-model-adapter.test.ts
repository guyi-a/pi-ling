import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { PiAiModelAdapter } from "../src/index.js";

describe("PiAiModelAdapter", () => {
  it("lists models and preserves the native pi-ai event stream", async () => {
    const models = createModels();
    const faux = fauxProvider();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage([fauxText("hello from pi-ai")])]);

    const model = faux.getModel();
    expect(model).toBeDefined();

    const adapter = new PiAiModelAdapter(models);
    expect(adapter.listModels(model?.provider)).toEqual([
      expect.objectContaining({
        provider: model?.provider,
        model: model?.id,
      }),
    ]);

    const handle = adapter.startStream({
      requestId: "request-1",
      selection: {
        provider: model?.provider ?? "",
        model: model?.id ?? "",
      },
      context: {
        messages: [
          {
            role: "user",
            content: "say hello",
            timestamp: Date.now(),
          },
        ],
      },
    });

    let streamedText = "";
    for await (const event of handle.events) {
      if (event.type === "text_delta") {
        streamedText += event.delta;
      }
    }

    const result = await handle.result();
    expect(streamedText).toBe("hello from pi-ai");
    expect(result.stopReason).toBe("stop");
    expect(adapter.cancel("request-1")).toBe(false);
  });

  it("rejects unknown model selections before starting a request", () => {
    const adapter = new PiAiModelAdapter(createModels());

    expect(() =>
      adapter.startStream({
        selection: { provider: "missing", model: "missing" },
        context: { messages: [] },
      }),
    ).toThrow("Unknown model: missing/missing");
  });
});
