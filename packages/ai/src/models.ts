import type { AssistantMessageEventStream } from "./event-stream.js";
import { failedStream } from "./message-utils.js";
import type {
  Context,
  Model,
  ProviderId,
  StreamOptions,
} from "./types.js";

export interface ProviderStreamOptions extends StreamOptions {
  apiKey: string;
}

export interface Provider {
  id: ProviderId;
  apiKeyEnv: string;
  models: readonly Model[];
  stream(
    model: Model,
    context: Context,
    options: ProviderStreamOptions,
  ): AssistantMessageEventStream;
}

export class Models {
  readonly #providers = new Map<ProviderId, Provider>();

  register(provider: Provider): this {
    this.#providers.set(provider.id, provider);
    return this;
  }

  getProviders(): readonly Provider[] {
    return [...this.#providers.values()];
  }

  getModels(provider?: ProviderId): readonly Model[] {
    if (provider) {
      return this.#providers.get(provider)?.models ?? [];
    }
    return this.getProviders().flatMap((item) => item.models);
  }

  getModel(provider: ProviderId, modelId: string): Model | undefined {
    return this.#providers
      .get(provider)
      ?.models.find((model) => model.id === modelId);
  }

  isConfigured(providerId: ProviderId): boolean {
    const provider = this.#providers.get(providerId);
    return Boolean(provider && process.env[provider.apiKeyEnv]?.trim());
  }

  stream(
    model: Model,
    context: Context,
    options: StreamOptions = {},
  ): AssistantMessageEventStream {
    const provider = this.#providers.get(model.provider);
    if (!provider) {
      return failedStream(
        model,
        new Error(`Provider is not registered: ${model.provider}`),
      );
    }

    const apiKey = options.apiKey ?? process.env[provider.apiKeyEnv]?.trim();
    if (!apiKey) {
      return failedStream(
        model,
        new Error(`Provider is not configured: ${model.provider}`),
      );
    }

    return provider.stream(model, context, { ...options, apiKey });
  }
}

export function createModels(providers: readonly Provider[] = []): Models {
  const models = new Models();
  for (const provider of providers) {
    models.register(provider);
  }
  return models;
}
