import { DshRuntimeAdapter } from "../../packages/dsh-runtime/dist/index.js";

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
      anthropic:
        apiKeyEnv: ANTHROPIC_API_KEY
        baseURL: !!js "process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'"
        reasoning: high

- id: acp
  name: '@deepseek-ai/dsh-acp'
  config:
    provider: deepseek
    model: deepseek-v4-flash
`.trimStart();

const options = {
  dshBin: bin,
  command: process.execPath,
  dshHome: home,
  cwd: sourceRoot,
  profilePatch,
  env: {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
  },
  initializeTimeoutMs: 30000,
};

const adapter = new DshRuntimeAdapter(options);
adapter.subscribe((e) => console.error("[event]", JSON.stringify(e).slice(0, 200)));

try {
  await adapter.initialize();
  console.log("=== INITIALIZE OK ===");
} catch (e) {
  console.log("=== INITIALIZE FAILED ===");
  console.error("message:", e.message);
  console.error("cause:", e.cause?.message ?? e.cause);
  console.error("--- adapter.stderr (diagnostics) ---");
  console.error(adapter.diagnostics);
  process.exit(1);
}

try {
  const result = await adapter.importSession({
    sessionId: "repro-session",
    workspaceRoot: "E:/pi-ling",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    canonicalMessages: [
      {
        id: "repro:user",
        role: "user",
        content: [{ type: "text", text: "hello, this is a repro" }],
        sourceRuntime: "dsh",
        createdAt: Date.now(),
      },
    ],
  });
  console.log("=== IMPORT OK ===", JSON.stringify(result));
} catch (e) {
  console.log("=== IMPORT FAILED ===");
  console.error("message:", e.message);
  console.error("cause:", e.cause?.message ?? e.cause);
  console.error("--- adapter.stderr (diagnostics) ---");
  console.error(adapter.diagnostics);
  process.exit(1);
}
await adapter.dispose();
process.exit(0);
