import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { existsSync } from "node:fs";

import { DshRuntimeAdapter } from "../../packages/dsh-runtime/dist/index.js";

Object.defineProperty(process.versions, "electron", {
  value: "30.0.0",
  configurable: true,
});

const dshHome = mkdtempSync(path.join(os.tmpdir(), "pi-ling-electron-repro-"));
const bin =
  process.env.PI_LING_DSH_BIN ??
  "E:/pi-ling/.dsh-source/apps/cli/lib/bin.js";
const sourceRoot = "E:/pi-ling/.dsh-source";

const profilePatch = `
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      deepseek:
        apiKeyEnv: DEEPSEEK_API_KEY
        baseURL: !!js "process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'"
        reasoning: high

- id: acp
  name: '@deepseek-ai/dsh-acp'
  config:
    provider: deepseek
    model: deepseek-v4-pro
    compaction:
      enabled: false
`.trimStart();

function resolveNodeFromPath() {
  for (const entry of (process.env.PATH ?? "").split(";")) {
    const candidate = path.join(entry.trim(), "node.exe");
    if (existsSync(candidate)) return candidate;
  }
  return process.env.PI_LING_ELECTRON_EXE?.trim() || process.execPath;
}

const command = resolveNodeFromPath();

const adapter = new DshRuntimeAdapter({
  dshBin: bin,
  command,
  dshHome,
  cwd: sourceRoot,
  profilePatch,
  env: {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "",
  },
  initializeTimeoutMs: 30_000,
});

process.stderr.write(`dshHome=${dshHome}\ncommand=${command}\n`);
await adapter.initialize();
process.stderr.write("=== INITIALIZE OK ===\n");

try {
  const result = await adapter.importSession({
    sessionId: randomUUID(),
    workspaceRoot: "E:/pi-ling",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    canonicalMessages: [
      {
        id: "repro:user",
        role: "user",
        content: [{ type: "text", text: "hello electron repro" }],
        sourceRuntime: "native",
        createdAt: Date.now(),
      },
    ],
  });
  process.stderr.write(`=== IMPORT OK === ${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`=== IMPORT FAILED === ${error.message}\n`);
  process.stderr.write(`${adapter.diagnostics}\n`);
  process.exitCode = 1;
} finally {
  await adapter.dispose();
}
