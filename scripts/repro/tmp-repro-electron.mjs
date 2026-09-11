// Reproduce the EXACT spawn context the real Electron app uses:
//   - process.versions.electron is set => childEnvironment() adds ELECTRON_RUN_AS_NODE=1
//   - child env is the stripped whitelist ({PATH,...} + DSH_HOME + options.env)
//   - dshBin resolved, PI_LING_DSH_MODULE_ROOT set for @deepseek-ai/* re-homing
import { DshRuntimeAdapter } from "../../packages/dsh-runtime/dist/index.js";

// Simulate running inside Electron so the runtime believes process.versions.electron is truthy.
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
  command: "node", // exactly what the real Electron app passes (resolveDshLaunchConfig default)
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
process.stderr.write("[mode] ELECTRON_RUN_AS_NODE will be set on child\n");
adapter.subscribe((e) => process.stderr.write("[event] " + JSON.stringify(e).slice(0, 200) + "\n"));

try {
  await adapter.initialize();
  process.stderr.write("=== INITIALIZE OK ===\n");
} catch (e) {
  process.stderr.write("=== INITIALIZE FAILED ===\nmessage: " + e.message + "\n");
  process.stderr.write("cause: " + (e.cause?.message ?? e.cause) + "\n");
  process.stderr.write("--- diagnostics (child stderr) ---\n" + adapter.diagnostics + "\n");
  process.exit(1);
}

try {
  const result = await adapter.importSession({
    sessionId: "repro-electron-session",
    workspaceRoot: "E:/pi-ling",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    canonicalMessages: [
      {
        id: "repro:user",
        role: "user",
        content: [{ type: "text", text: "hello, this is an electron-context repro" }],
        sourceRuntime: "dsh",
        createdAt: Date.now(),
      },
    ],
  });
  process.stderr.write("=== IMPORT OK === " + JSON.stringify(result) + "\n");
} catch (e) {
  process.stderr.write("=== IMPORT FAILED ===\nmessage: " + e.message + "\n");
  process.stderr.write("cause: " + (e.cause?.message ?? e.cause) + "\n");
  process.stderr.write("--- diagnostics (child stderr) ---\n" + adapter.diagnostics + "\n");
  process.exit(1);
}
await adapter.dispose();
process.exit(0);
