import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { DshRuntimeAdapter } from "../../packages/dsh-runtime/dist/index.js";

process.loadEnvFile("C:/Users/ASUS/AppData/Roaming/@pi-ling/desktop/.env");
process.env.PI_LING_DSH_FS_EXT_HOOK =
  "C:/Users/ASUS/AppData/Local/Programs/pi-ling/resources/app.asar.unpacked/out/main/fs-ext-hook.js";
process.env.PI_LING_DSH_SESSION_IMPORT =
  "C:/Users/ASUS/AppData/Local/Programs/pi-ling/resources/app.asar.unpacked/out/main/dsh-transcript/dsh-session-import.js";

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

const adapter = new DshRuntimeAdapter({
  dshBin: process.env.PI_LING_DSH_BIN,
  command: "E:/node.exe",
  dshHome:
    "C:/Users/ASUS/AppData/Roaming/@pi-ling/desktop/dsh/0.1.3-alpha.1-d347e703",
  cwd: "E:/pi-ling/.dsh-source",
  profilePatch,
  env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "" },
  initializeTimeoutMs: 30_000,
});

const canonicalMessages = [
  {
    id: "switch:user",
    role: "user",
    content: [{ type: "text", text: "你好" }],
    sourceRuntime: "native",
    createdAt: Date.now(),
  },
];

const productSessionId = "test-product-session";
const externalId = randomUUID();

try {
  await adapter.initialize();
  console.log("INIT OK");
  const imported = await adapter.importSession({
    sessionId: externalId,
    workspaceRoot: "E:/pi-ling",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    canonicalMessages,
  });
  console.log("IMPORT OK", imported);
  const resumed = await adapter.resumeSession({
    sessionId: productSessionId,
    workspaceRoot: "E:/pi-ling",
    externalSessionId: externalId,
  });
  console.log("RESUME OK", resumed);
} catch (error) {
  console.error("FAILED", error);
  console.error("name:", error?.constructor?.name);
  console.error("message:", error?.message);
  console.error("stderr:", adapter.diagnostics.slice(-3000));
  process.exitCode = 1;
} finally {
  await adapter.dispose();
}
