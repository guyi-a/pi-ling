import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { DshRuntimeAdapter } from "../../packages/dsh-runtime/dist/index.js";

process.loadEnvFile("C:/Users/ASUS/AppData/Roaming/@pi-ling/desktop/.env");
Object.defineProperty(process.versions, "electron", {
  value: "44.2.0",
  configurable: true,
});

process.env.PI_LING_DSH_FS_EXT_HOOK =
  "C:/Users/ASUS/AppData/Local/Programs/pi-ling/resources/app.asar.unpacked/out/main/fs-ext-hook.js";
process.env.PI_LING_DSH_SESSION_IMPORT =
  "C:/Users/ASUS/AppData/Local/Programs/pi-ling/resources/app.asar.unpacked/out/main/dsh-transcript/dsh-session-import.js";

function resolveNodeFromPath() {
  for (const entry of (process.env.PATH ?? "").split(";")) {
    const candidate = `${entry.trim()}\\node.exe`;
    if (existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

const dshBin = process.env.PI_LING_DSH_BIN;
const command = resolveNodeFromPath();
const dshHome =
  "C:/Users/ASUS/AppData/Roaming/@pi-ling/desktop/dsh/0.1.3-alpha.1-d347e703";

console.log("command:", command);
console.log("dshBin:", dshBin);
console.log("dshHome:", dshHome);
console.log("hook exists:", existsSync(process.env.PI_LING_DSH_FS_EXT_HOOK));
console.log(
  "import plugin exists:",
  existsSync(process.env.PI_LING_DSH_SESSION_IMPORT),
);

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
  dshBin,
  command,
  dshHome,
  cwd: "E:/pi-ling/.dsh-source",
  profilePatch,
  env: { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? "" },
});
try {
  await adapter.initialize();
  console.log("INIT OK");
  const result = await adapter.importSession({
    sessionId: randomUUID(),
    workspaceRoot: "E:/pi-ling",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    canonicalMessages: [
      {
        id: "packaged:user",
        role: "user",
        content: [{ type: "text", text: "packaged repro" }],
        sourceRuntime: "native",
        createdAt: Date.now(),
      },
    ],
  });
  console.log("IMPORT OK", result);
} catch (error) {
  console.error("FAILED:", error.message);
  console.error("STDERR:", adapter.diagnostics.slice(-4000));
  process.exitCode = 1;
} finally {
  await adapter.dispose();
}
