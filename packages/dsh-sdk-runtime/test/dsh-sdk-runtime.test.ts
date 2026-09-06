import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeEvent } from "@pi-ling/runtime-contracts";
import { describe, expect, it } from "vitest";

import {
  DshSdkRuntimeAdapter,
  mapSdkSessionEvent,
} from "../src/index.js";

describe("DshSdkRuntimeAdapter PoC", () => {
  it("maps committed SDK message and tool events", () => {
    expect(
      mapSdkSessionEvent("session", "run", {
        type: "assistant/message",
        data: {
          message: {
            content: [
              { type: "reasoning", text: "think" },
              { type: "text", text: "done" },
            ],
          },
          usage: { inputTokens: 2, outputTokens: 1 },
        },
      }),
    ).toEqual([
      {
        type: "assistant_thought",
        sessionId: "session",
        runId: "run",
        delta: "think",
      },
      {
        type: "assistant_text",
        sessionId: "session",
        runId: "run",
        delta: "done",
      },
      {
        type: "usage",
        sessionId: "session",
        runId: "run",
        used: 3,
        size: 0,
      },
    ]);
    expect(
      mapSdkSessionEvent("session", "run", {
        type: "tool/call",
        data: {
          callId: "call",
          name: "read",
          arguments: '{"path":"a.ts"}',
        },
      }),
    ).toEqual([
      expect.objectContaining({
        type: "tool",
        sessionId: "session",
        callId: "call",
        input: { path: "a.ts" },
      }),
    ]);
  });

  it("declares unsupported SDK protocol capabilities explicitly", () => {
    const adapter = new DshSdkRuntimeAdapter({
      dshBin: "dsh.js",
      dshHome: "home",
      cwd: ".",
    });
    expect(adapter.capabilities).toMatchObject({
      partialStreaming: false,
      toolApproval: false,
      resume: false,
    });
  });

  it.skipIf(process.env["RUN_REAL_DSH_SDK_POC"] !== "1")(
    "runs two real turns through the DSH SDK subprocess",
    async () => {
      process.loadEnvFile(
        fileURLToPath(new URL("../../../.env", import.meta.url)),
      );
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "pi-ling-dsh-sdk-"),
      );
      const events: RuntimeEvent[] = [];
      const adapter = new DshSdkRuntimeAdapter({
        dshBin: "E:/deepseek-harness/apps/cli/lib/bin.js",
        dshHome: path.join(directory, "dsh-home"),
        cwd: "E:/pi-ling",
        processCwd: "E:/deepseek-harness",
        nodeImportHook:
          "file:///E:/pi-ling/packages/dsh-runtime/dist/fs-ext-hook.js",
        env: process.env["DEEPSEEK_API_KEY"]
          ? { DEEPSEEK_API_KEY: process.env["DEEPSEEK_API_KEY"] }
          : {},
      });
      const unsubscribe = adapter.subscribe((event) => {
        events.push(event);
      });
      try {
        await adapter.createSession({
          sessionId: "sdk-poc-session",
          workspaceRoot: "E:/pi-ling",
        });
        await adapter.send(
          "sdk-poc-session",
          "sdk-run-1",
          "Remember the code SDK-EMBER-91. Reply only: remembered",
        );
        await adapter.send(
          "sdk-poc-session",
          "sdk-run-2",
          "What code did I ask you to remember? Reply with only the code.",
        );
        expect(
          events
            .filter((event) => event.type === "assistant_text")
            .map((event) => event.delta)
            .join(""),
        ).toContain("SDK-EMBER-91");

        await adapter.dispose();
        const resumed = new DshSdkRuntimeAdapter({
          dshBin: "E:/deepseek-harness/apps/cli/lib/bin.js",
          dshHome: path.join(directory, "dsh-home"),
          cwd: "E:/pi-ling",
          processCwd: "E:/deepseek-harness",
          nodeImportHook:
            "file:///E:/pi-ling/packages/dsh-runtime/dist/fs-ext-hook.js",
          env: process.env["DEEPSEEK_API_KEY"]
            ? { DEEPSEEK_API_KEY: process.env["DEEPSEEK_API_KEY"] }
            : {},
        });
        try {
          await resumed.resumeSession({
            sessionId: "sdk-poc-session",
            externalSessionId: "sdk-poc-session",
            workspaceRoot: "E:/pi-ling",
          });
          await expect(
            resumed.send(
              "sdk-poc-session",
              "sdk-run-resume",
              "Reply only: resumed",
            ),
          ).rejects.toThrow();
        } finally {
          await resumed.dispose();
        }
      } finally {
        unsubscribe();
        await adapter.dispose();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
