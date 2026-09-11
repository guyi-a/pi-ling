import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(new URL("../.env", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
} catch {
  /* optional */
}

const {
  CodexRuntimeAdapter,
  resolveBundledCodexBin,
  writeDeepSeekCodexHome,
  CODEX_DEFAULT_DEEPSEEK_MODEL,
} = await import("../packages/codex-runtime/dist/index.js");

const codexHome = await mkdtemp(join(tmpdir(), "pi-ling-codex-smoke-"));
writeDeepSeekCodexHome(codexHome);
const codexBin = resolveBundledCodexBin();
if (!process.env.DEEPSEEK_API_KEY?.trim()) {
  console.error("DEEPSEEK_API_KEY missing");
  process.exit(1);
}

const adapter = new CodexRuntimeAdapter({
  codexHome,
  codexBin,
  model: CODEX_DEFAULT_DEEPSEEK_MODEL,
  env: {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    CODEX_HOME: codexHome,
  },
});

await adapter.initialize();
const events = [];
adapter.subscribe((event) => {
  events.push(event);
  if (event.type === "assistant_text" || event.type === "run_end") {
    console.log("event", event.type, event.delta ?? event.status, event.error ?? "");
  }
});

await adapter.createSession({
  sessionId: "local",
  workspaceRoot: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
});

await adapter.send("local", "run1", "Reply with exactly: pong");
await adapter.dispose();
console.log("ok");
