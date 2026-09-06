import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DshRuntimeAdapter } from "@pi-ling/dsh-runtime";
import { describe, expect, it } from "vitest";

import { SessionStore } from "./session-store/session-store.js";
import { SessionSupervisor } from "./session-supervisor.js";

describe("real DSH unified session smoke", () => {
  it.skipIf(process.env["RUN_REAL_DSH_UNIFIED_SMOKE"] !== "1")(
    "persists a real DSH prompt as canonical session events",
    async () => {
      process.loadEnvFile(
        fileURLToPath(new URL("../../../../.env", import.meta.url)),
      );
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "pi-ling-dsh-unified-"),
      );
      const runtime = new DshRuntimeAdapter({
        dshBin: "E:/deepseek-harness/apps/cli/lib/bin.js",
        command: "E:/node.exe",
        dshHome: path.join(directory, "dsh-home"),
        cwd: "E:/deepseek-harness",
        env: process.env["DEEPSEEK_API_KEY"]
          ? { DEEPSEEK_API_KEY: process.env["DEEPSEEK_API_KEY"] }
          : {},
      });
      const store = new SessionStore(path.join(directory, "pi-ling.db"));
      const supervisor = new SessionSupervisor(
        store,
        () => {},
        () => {},
        runtime,
      );
      try {
        const activation = await supervisor.create({
          workspaceRoot: "E:/pi-ling",
          runtimeKind: "dsh",
        });
        supervisor.startPrompt(
          "real-dsh-run",
          "Reply with exactly: unified-dsh-ok",
          activation.session.id,
        );
        const deadline = Date.now() + 60_000;
        while (
          store.getSession(activation.session.id)?.lifecycle !== "idle"
        ) {
          if (Date.now() > deadline) throw new Error("DSH smoke timed out");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const events = store.loadSessionEvents(activation.session.id);
        expect(events.map(({ event }) => event.kind)).toContain(
          "message.assistant.committed",
        );
        expect(JSON.stringify(events)).toContain("unified-dsh-ok");
        expect(
          supervisor
            .snapshot(activation.session.id)
            .events.some(
              ({ event }) =>
                event.type === "assistant_text_delta" &&
                event.delta.includes("unified-dsh-ok"),
            ),
        ).toBe(true);
      } finally {
        await supervisor.dispose();
        await runtime.dispose();
        store.close();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
