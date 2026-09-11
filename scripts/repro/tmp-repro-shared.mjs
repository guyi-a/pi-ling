// Reproduce the App's SHARED-long-lived-sidecar scenario:
// one DshRuntimeAdapter instance, ONE sidecar, TWO sequential imports.
// Hypothesis: the sidecar dies after the first import, killing the second.
import { DshRuntimeAdapter } from "../../packages/dsh-runtime/dist/index.js";

Object.defineProperty(process.versions, "electron", {
  value: "30.0.0",
  configurable: true,
});

const bin = "E:/deepseek-harness-d347e703/apps/cli/lib/bin.js";
const sourceRoot = "E:/deepseek-harness-d347e703";
const home = process.env.DSH_HOME;
if (!home) throw new Error("DSH_HOME not set");

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
    model: deepseek-v4-flash
`.trimStart();

const options = {
  dshBin: bin,
  command: "node",
  dshHome: home,
  cwd: sourceRoot,
  profilePatch,
  env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY },
  initializeTimeoutMs: 30000,
  shutdownTimeoutMs: 3000,
};

const messages = [
  {
    id: "m:user",
    role: "user",
    content: [{ type: "text", text: "你好，我是小�? }],
    sourceRuntime: "native",
    createdAt: Date.now(),
  },
];

const adapter = new DshRuntimeAdapter(options);
adapter.subscribe((e) => process.stderr.write("[event] " + JSON.stringify(e).slice(0, 200) + "\n"));

async function step(label, fn) {
  try {
    const r = await fn();
    process.stderr.write("=== " + label + " OK === " + (r ? JSON.stringify(r) : "") + "\n");
    return r;
  } catch (e) {
    process.stderr.write("=== " + label + " FAILED ===\nmessage: " + e.message + "\n");
    process.stderr.write("cause: " + (e.cause?.message ?? e.cause) + "\n");
    process.stderr.write("--- diagnostics ---\n" + adapter.diagnostics + "\n");
    throw e;
  }
}

try {
  await step("INITIALIZE", () => adapter.initialize());

  // First import (like d47bc2fe: create path is separate; here a first import).
  const firstId = crypto.randomUUID();
  await step("IMPORT #1", () =>
    adapter.importSession({
      sessionId: firstId,
      workspaceRoot: "E:/klingwork-app",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      canonicalMessages: messages,
    }),
  );

  // Second import on the SAME sidecar (like e69949ab after d47bc2fe).
  const secondId = crypto.randomUUID();
  await step("IMPORT #2", () =>
    adapter.importSession({
      sessionId: secondId,
      workspaceRoot: "E:/klingwork-app",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      canonicalMessages: messages,
    }),
  );
} catch (e) {
  process.exit(1);
}
await adapter.dispose();
process.exit(0);
