// Faithful reproduction of DshAgentSession.open() for e69949ab,
// using the REAL compiled DshRuntimeAdapter from dist.
// Simulates Electron context (process.versions.electron set) so the child
// gets ELECTRON_RUN_AS_NODE=1, exactly like the real app.
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
  command: "node",
  dshHome: home,
  cwd: sourceRoot,
  profilePatch,
  env: {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  },
  initializeTimeoutMs: 30000,
};

// The exact canonical messages projectCanonicalMessages produces for e69949ab.
const messages = [
  {
    id: "e96f09db-f60a-4f50-bf7a-b705970f7319:user",
    role: "user",
    content: [{ type: "text", text: "你好，我是小�? }],
    sourceRuntime: "native",
    createdAt: 1788800704930,
  },
  {
    id: "e96f09db-f60a-4f50-bf7a-b705970f7319:turn:1:assistant",
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "The user just said \"你好，我是小明\" (Hello, I am Xiaoming). This is a greeting. I should respond politely. There's no actual task yet. Let me respond in Chinese.",
        signature: "reasoning_content",
      },
      {
        type: "text",
        text: "你好，小明！我是 pi-ling，你的编程助手，工作目录�?`E:\\klingwork-app`。\n\n有什么我可以帮你的吗？比如查看项目代码、修改功能、排查问题等，都可以告诉我�?,
      },
    ],
    sourceRuntime: "native",
    createdAt: 1788800705001,
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

  // App uses randomUUID(): emulate a fresh id
  const importedId = crypto.randomUUID();
  const imported = await step("IMPORT", () =>
    adapter.importSession({
      sessionId: importedId,
      workspaceRoot: "E:/klingwork-app",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      canonicalMessages: messages,
    }),
  );

  await step("RESUME", () =>
    adapter.resumeSession({
      sessionId: importedId,
      workspaceRoot: "E:/klingwork-app",
      externalSessionId: importedId,
    }),
  );
} catch (e) {
  process.exit(1);
}
await adapter.dispose();
process.exit(0);
