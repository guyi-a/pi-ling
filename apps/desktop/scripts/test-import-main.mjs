import { appendFileSync } from "node:fs";
import { join } from "node:path";

const logPath = join(process.env.APPDATA ?? "", "@pi-ling", "desktop", "import-main.log");

function log(message) {
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, { flag: "a" });
}

const mainUrl =
  "file:///C:/Users/ASUS/AppData/Local/Programs/pi-ling/resources/app.asar/out/main/index.js";

try {
  log("importing main...");
  await import(mainUrl);
  log("main import resolved");
} catch (error) {
  log(
    `main import failed ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }`,
  );
}
