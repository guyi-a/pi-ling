import type {
  LlmConfigSnapshot,
  LlmModelOption,
  LlmProviderOption,
} from "@pi-ling/contracts";

import {
  defaultLlmProvider,
  getLlmProviderDefinition,
  LLM_PROVIDER_CATALOG,
  type LlmProviderDefinition,
} from "./catalog.js";

export interface SavedLlmConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface ResolvedLlmConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  apiKeyEnv: string;
  baseUrlEnv?: string;
  providerLabel: string;
}

export type { LlmConfigSnapshot, LlmModelOption, LlmProviderOption };

function readEnvString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function resolveProviderDefinition(
  providerId: string | undefined,
): LlmProviderDefinition {
  if (providerId) {
    const match = getLlmProviderDefinition(providerId);
    if (match) return match;
  }
  return defaultLlmProvider();
}

export function resolveLlmConfig(
  saved: SavedLlmConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLlmConfig {
  const providerId =
    saved?.provider?.trim() ||
    readEnvString(env, "PI_LING_PROVIDER") ||
    defaultLlmProvider().id;
  const definition = resolveProviderDefinition(providerId);
  const model =
    saved?.model?.trim() ||
    readEnvString(env, "PI_LING_MODEL") ||
    definition.defaultModel;
  const apiKey =
    saved?.apiKey?.trim() ||
    readEnvString(env, definition.apiKeyEnv) ||
    "";
  const configuredBaseUrl =
    saved?.baseUrl?.trim() ||
    (definition.baseUrlEnv
      ? readEnvString(env, definition.baseUrlEnv)
      : undefined);
  const baseUrl = configuredBaseUrl || definition.defaultBaseUrl;

  return {
    provider: definition.id,
    model,
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    apiKeyEnv: definition.apiKeyEnv,
    ...(definition.baseUrlEnv ? { baseUrlEnv: definition.baseUrlEnv } : {}),
    providerLabel: definition.label,
  };
}

export function isLlmConfigured(config: ResolvedLlmConfig): boolean {
  return config.apiKey.length > 0;
}

export function applyLlmConfigToProcessEnv(
  config: ResolvedLlmConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env.PI_LING_PROVIDER = config.provider;
  env.PI_LING_MODEL = config.model;
  env[config.apiKeyEnv] = config.apiKey;
  if (config.baseUrlEnv && config.baseUrl) {
    env[config.baseUrlEnv] = config.baseUrl;
  }
}

export function previewApiKey(apiKey: string): string | undefined {
  const trimmed = apiKey.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 3)}…${trimmed.slice(-4)}`;
}

export function buildLlmConfigSnapshot(
  saved: SavedLlmConfig | undefined,
  models: LlmModelOption[],
  env: NodeJS.ProcessEnv = process.env,
): LlmConfigSnapshot {
  const resolved = resolveLlmConfig(saved, env);
  const preview = previewApiKey(resolved.apiKey);
  const snapshot: LlmConfigSnapshot = {
    provider: resolved.provider,
    providerLabel: resolved.providerLabel,
    model: resolved.model,
    apiKeyConfigured: isLlmConfigured(resolved),
    providers: LLM_PROVIDER_CATALOG.map((entry) => ({
      id: entry.id,
      label: entry.label,
      defaultModel: entry.defaultModel,
      ...(entry.defaultBaseUrl
        ? { defaultBaseUrl: entry.defaultBaseUrl }
        : {}),
      supportedRuntimes: entry.supportedRuntimes,
      apiKeyEnv: entry.apiKeyEnv,
    })),
    models,
  };
  const providerDef = getLlmProviderDefinition(resolved.provider);
  const configuredBaseUrl =
    saved?.baseUrl?.trim() ||
    (providerDef?.baseUrlEnv
      ? readEnvString(env, providerDef.baseUrlEnv)
      : undefined);
  if (configuredBaseUrl) snapshot.baseUrl = configuredBaseUrl;
  if (preview) snapshot.apiKeyPreview = preview;
  return snapshot;
}
