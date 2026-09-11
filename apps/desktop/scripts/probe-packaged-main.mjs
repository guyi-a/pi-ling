import { appendFileSync } from "node:fs";
import { join } from "node:path";

const logPath = join(process.env.APPDATA ?? "", "@pi-ling", "desktop", "probe.log");

function log(message) {
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { flag: "a" });
}

try {
  log("probe start");
  log(`execPath=${process.execPath}`);
  log(`cwd=${process.cwd()}`);
  log(`versions=${JSON.stringify(process.versions)}`);
  const pty = await import("node-pty");
  log(`node-pty ok spawn=${typeof pty.spawn}`);
} catch (error) {
  log(
    `node-pty fail ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }`,
  );
}

try {
  log("loading main...");
  await import("../out/main/index.js");
  log("main loaded");
} catch (error) {
  log(
    `main fail ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }`,
  );
}
