import { randomUUID } from "node:crypto";

import type {
  Models,
  ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

import type {
  ModelDescriptor,
  ModelSelection,
  ModelStreamHandle,
  StartModelStreamRequest,
} from "./types.js";

export class PiAiModelAdapter {
  readonly #models: Models;
  readonly #activeRequests = new Map<string, AbortController>();

  constructor(models: Models) {
    this.#models = models;
  }

  listModels(provider?: string): ModelDescriptor[] {
    return this.#models.getModels(provider).map((model) => ({
      provider: model.provider,
      model: model.id,
      name: model.name,
      api: model.api,
      reasoning: model.reasoning,
      input: [...model.input],
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }));
  }

  async listAvailableModels(provider?: string): Promise<ModelDescriptor[]> {
    const models = await this.#models.getAvailable(provider);
    const available = new Set(
      models.map((model) => `${model.provider}\u0000${model.id}`),
    );
    return this.listModels(provider).filter((model) =>
      available.has(`${model.provider}\u0000${model.model}`),
    );
  }

  hasModel(selection: ModelSelection): boolean {
    return Boolean(
      this.#models.getModel(selection.provider, selection.model),
    );
  }

  startStream(request: StartModelStreamRequest): ModelStreamHandle {
    const requestId = request.requestId ?? randomUUID();
    if (this.#activeRequests.has(requestId)) {
      throw new Error(`Model request already exists: ${requestId}`);
    }

    const model = this.#models.getModel(
      request.selection.provider,
      request.selection.model,
    );
    if (!model) {
      throw new Error(
        `Unknown model: ${request.selection.provider}/${request.selection.model}`,
      );
    }

    const controller = new AbortController();
    this.#activeRequests.set(requestId, controller);

    const options: ModelsSimpleStreamOptions = {
      signal: controller.signal,
    };
    if (request.sessionId !== undefined) {
      options.sessionId = request.sessionId;
    }
    if (
      request.thinkingLevel !== undefined &&
      request.thinkingLevel !== "off"
    ) {
      options.reasoning = request.thinkingLevel;
    }

    try {
      const events = this.#models.streamSimple(
        model,
        request.context,
        options,
      );
      void events.result().finally(() => {
        this.#activeRequests.delete(requestId);
      });

      return {
        requestId,
        events,
        result: () => events.result(),
        cancel: () => controller.abort(),
      };
    } catch (error) {
      this.#activeRequests.delete(requestId);
      throw error;
    }
  }

  cancel(requestId: string): boolean {
    const request = this.#activeRequests.get(requestId);
    if (!request) {
      return false;
    }
    request.abort();
    return true;
  }

  dispose(): void {
    for (const request of this.#activeRequests.values()) {
      request.abort();
    }
    this.#activeRequests.clear();
  }
}

export function createBuiltInPiAiModelAdapter(): PiAiModelAdapter {
  return new PiAiModelAdapter(builtinModels());
}
