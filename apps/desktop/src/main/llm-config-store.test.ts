import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLlmConfigSnapshot,
  hydrateLlmConfigFromDisk,
  initLlmConfigStore,
  saveLlmConfig,
} from "./llm-config-store.js";

describe("llm-config-store", () => {
  let configDir = "";

  beforeEach(async () => {
    configDir = join(tmpdir(), `pi-ling-llm-config-${Date.now()}`);
    await mkdir(configDir, { recursive: true });
    initLlmConfigStore(configDir);
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
    delete process.env.PI_LING_PROVIDER;
    delete process.env.PI_LING_MODEL;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it("persists provider, model, and api key", async () => {
    await saveLlmConfig({
      provider: "deepseek",
      model: "deepseek-flash",
      apiKey: "test-key",
    });

    await hydrateLlmConfigFromDisk();
    const snapshot = await getLlmConfigSnapshot();
    expect(snapshot.provider).toBe("deepseek");
    expect(snapshot.model).toBe("deepseek-flash");
    expect(snapshot.apiKeyConfigured).toBe(true);
    expect(process.env.DEEPSEEK_API_KEY).toBe("test-key");
  });
});
