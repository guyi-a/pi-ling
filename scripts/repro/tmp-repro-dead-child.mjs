import { randomUUID } from "node:crypto";

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
- id: acp
  name: '@deepseek-ai/dsh-acp'
  config:
    provider: deepseek
    model: deepseek-v4-pro
`.trimStart();

const adapter = new DshRuntimeAdapter({
  dshBin: process.env.PI_LING_DSH_BIN,
  command: "E:/node.exe",
  dshHome:
    "C:/Users/ASUS/AppData/Roaming/@pi-ling/desktop/dsh/0.1.3-alpha.1-d347e703",
  cwd: "E:/pi-ling/.dsh-source",
  profilePatch,
  env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "" },
  initializeTimeoutMs: 10_000,
});

await adapter.initialize();
console.log("init ok, killing child");
adapter._child?.kill("SIGKILL");
await new Promise((resolve) => setTimeout(resolve, 500));

try {
  await adapter.importSession({
    sessionId: randomUUID(),
    workspaceRoot: "E:/pi-ling",
    canonicalMessages: [
      {
        id: "dead:user",
        role: "user",
        content: [{ type: "text", text: "after kill" }],
        sourceRuntime: "native",
        createdAt: Date.now(),
      },
    ],
  });
  console.log("unexpected success");
} catch (error) {
  console.log("fail:", error.message);
}
