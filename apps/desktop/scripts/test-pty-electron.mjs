import { appendFileSync } from "node:fs";
import { join } from "node:path";

const logPath = join(process.env.APPDATA ?? "", "@pi-ling", "desktop", "pty-test.log");
function log(message) {
  appendFileSync(logPath, `${message}\n`, { flag: "a" });
}

try {
  log("start");
  const pty = await import("node-pty");
  log(`pty ok ${typeof pty.spawn}`);
} catch (error) {
  log(`pty fail ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
}
