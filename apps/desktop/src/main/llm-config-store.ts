import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  LlmConfigSaveRequest,
  LlmConfigSaveResult,
  LlmConfigSnapshot,
} from "@pi-ling/contracts";
import {
  applyLlmConfigToProcessEnv,
  buildLlmConfigSnapshot,
  resolveLlmConfig,
  type SavedLlmConfig,
} from "@pi-ling/llm-config";

import { listPiAiModels } from "./llm-model-registry.js";

const CONFIG_FILE = "llm-config.json";

let configPath = "";
let savedConfig: SavedLlmConfig | undefined;

function assertConfigPath(): string {
  if (!configPath) {
    throw new Error("LLM config store is not initialized");
  }
  return configPath;
}

export function initLlmConfigStore(userDataPath: string): void {
  configPath = join(userDataPath, CONFIG_FILE);
}

async function readSavedConfig(): Promise<SavedLlmConfig | undefined> {
  if (savedConfig) return savedConfig;
  const path = assertConfigPath();
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as SavedLlmConfig;
    if (
      typeof parsed.provider === "string" &&
      typeof parsed.model === "string"
    ) {
      savedConfig = parsed;
      return parsed;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return undefined;
}

export async function hydrateLlmConfigFromDisk(): Promise<void> {
  const saved = await readSavedConfig();
  applyLlmConfigToProcessEnv(resolveLlmConfig(saved, process.env));
}

export function getResolvedLlmConfig() {
  return resolveLlmConfig(savedConfig, process.env);
}

export async function getLlmConfigSnapshot(): Promise<LlmConfigSnapshot> {
  const saved = await readSavedConfig();
  const resolved = resolveLlmConfig(saved, process.env);
  return buildLlmConfigSnapshot(
    saved,
    listPiAiModels(resolved.provider),
    process.env,
  );
}

export async function saveLlmConfig(
  request: LlmConfigSaveRequest,
): Promise<LlmConfigSaveResult> {
  const previous = await readSavedConfig();
  const previousResolved = resolveLlmConfig(previous, process.env);
  const next: SavedLlmConfig = {
    provider: request.provider.trim(),
    model: request.model.trim(),
    baseUrl: request.baseUrl?.trim() || undefined,
    apiKey:
      request.apiKey === undefined
        ? previous?.apiKey
        : request.apiKey.trim() || previous?.apiKey,
  };

  if (!next.provider || !next.model) {
    throw new Error("Provider and model are required");
  }

  const path = assertConfigPath();
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);

  savedConfig = next;
  applyLlmConfigToProcessEnv(resolveLlmConfig(next, process.env));

  const snapshot = await getLlmConfigSnapshot();
  const requiresSessionRestart =
    previousResolved.provider !== snapshot.provider ||
    previousResolved.model !== snapshot.model ||
    previousResolved.apiKey !== resolveLlmConfig(next, process.env).apiKey;

  return { snapshot, requiresSessionRestart };
}
