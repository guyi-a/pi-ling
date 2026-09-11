"use strict";

const { appendFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

function bootLog(message) {
  try {
    const dir = join(process.env.APPDATA ?? "", "@pi-ling", "desktop");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "boot.log"),
      `${new Date().toISOString()} ${message}\n`,
      { flag: "a" },
    );
  } catch {
    // ignore
  }
}

bootLog("bootstrap start");

process.on("uncaughtException", (error) => {
  bootLog(
    `uncaughtException: ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }`,
  );
});

process.on("unhandledRejection", (reason) => {
  bootLog(
    `unhandledRejection: ${
      reason instanceof Error ? reason.stack ?? reason.message : String(reason)
    }`,
  );
});

import("./index.js").catch((error) => {
  bootLog(
    `main import failed: ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }`,
  );
  process.exit(1);
});
