import { createModels } from "@earendil-works/pi-ai";
import {
  registerPiLingDeepseekProvider,
  PI_LING_DEEPSEEK_MODEL,
  PI_LING_DEEPSEEK_PROVIDER,
} from "@pi-ling/coding-agent";
import type { LlmModelOption } from "@pi-ling/contracts";
import { getLlmProviderDefinition } from "@pi-ling/llm-config";

const models = createModels();
registerPiLingDeepseekProvider(models);

export function listPiAiModels(providerId: string): LlmModelOption[] {
  const definition = getLlmProviderDefinition(providerId);
  if (!definition) return [];

  const catalog = models
    .getModels(providerId)
    .map((model) => ({ id: model.id, name: model.name }));

  if (
    providerId === PI_LING_DEEPSEEK_PROVIDER &&
    !catalog.some((model) => model.id === PI_LING_DEEPSEEK_MODEL)
  ) {
    catalog.unshift({
      id: PI_LING_DEEPSEEK_MODEL,
      name: "DeepSeek V4.1 Flash",
    });
  }

  if (catalog.some((model) => model.id === definition.defaultModel)) {
    return catalog;
  }

  return [
    { id: definition.defaultModel, name: definition.defaultModel },
    ...catalog,
  ];
}

export function getPiAiModel(providerId: string, modelId: string) {
  if (
    providerId === PI_LING_DEEPSEEK_PROVIDER &&
    modelId === PI_LING_DEEPSEEK_MODEL
  ) {
    registerPiLingDeepseekProvider(models);
  }
  return models.getModel(providerId, modelId);
}

export { models as piAiModels };
