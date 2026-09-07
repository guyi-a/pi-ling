import { execFileSync } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  startMockLlmServer,
  type MockLlmServer,
} from "@deepseek-ai/dsh-llm-mock-server";
import { DshRuntimeAdapter } from "@pi-ling/dsh-runtime";
import type { CanonicalMessage } from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const projectEnv = path.join(projectRoot, ".env");

function loadProjectEnv(): void {
  if (existsSync(projectEnv)) process.loadEnvFile(projectEnv);
}

function profilePatch(): string {
  return `
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      deepseek:
        apiKeyEnv: DEEPSEEK_API_KEY
        baseURL: !!js "process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'"
      anthropic:
        apiKeyEnv: ANTHROPIC_API_KEY
        baseURL: !!js "process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com'"

- id: acp
  name: '@deepseek-ai/dsh-acp'
  config:
    provider: deepseek
    model: deepseek-v4-flash
`.trimStart();
}

function realDshOptions(dshHome: string, model: MockLlmServer) {
  loadProjectEnv();
  const sourceRoot =
    process.env["PI_LING_DSH_WORKTREE"] ??
    path.join(projectRoot, ".dsh-source");
  const dshBin =
    process.env["PI_LING_DSH_BIN"] ??
    path.join(sourceRoot, "apps", "cli", "lib", "bin.js");
  const command = process.env["PI_LING_NODE_BIN"] ?? process.execPath;
  const rootManifest = JSON.parse(
    readFileSync(path.join(sourceRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  const commit = execFileSync(
    "git",
    ["-C", sourceRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  expect(rootManifest.version).toBe("0.1.3-alpha.1");
  expect(commit).toBe("d347e703908d0406b7a7ef80e3a0e594d86b2215");
  expect(existsSync(dshBin)).toBe(true);
  expect(existsSync(command)).toBe(true);
  return {
    dshBin,
    command,
    dshHome,
    cwd: sourceRoot,
    profilePatch: profilePatch(),
    env: {
      DEEPSEEK_API_KEY: "mock-key",
      DEEPSEEK_BASE_URL: model.baseURL,
    },
  };
}

const canonicalHistory: CanonicalMessage[] = [
  {
    id: "canonical-user-1",
    role: "user",
    sourceRuntime: "native",
    createdAt: 1,
    content: [{ type: "text", text: "My test code is ORANGE-42." }],
  },
  {
    id: "canonical-assistant-1",
    role: "assistant",
    sourceRuntime: "native",
    createdAt: 1,
    content: [{ type: "text", text: "I will remember that code." }],
  },
];

describe.sequential("real DSH Canonical Seed spike", () => {
  it.skipIf(process.env["RUN_REAL_DSH_SEED_SPIKE"] !== "1")(
    "imports canonical history through importSession and recalls it via resume",
    async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "pi-ling-seed-spike-"),
      );
      const dshHome = path.join(directory, "dsh-home");
      const externalSessionId = "seed-session-42";

      const model = await startMockLlmServer({
        sequence: ["success"],
        apiKey: "mock-key",
        successText: "recalled",
      });
      const adapter = new DshRuntimeAdapter({
        ...realDshOptions(dshHome, model),
        env: {
          DEEPSEEK_API_KEY: "mock-key",
          DEEPSEEK_BASE_URL: model.baseURL,
        },
      });
      try {
        await adapter.initialize();
        const imported = await adapter.importSession({
          sessionId: externalSessionId,
          workspaceRoot: directory,
          provider: "deepseek",
          model: "deepseek-v4-flash",
          canonicalMessages: canonicalHistory,
        });
        expect(imported.externalSessionId).toBe(externalSessionId);
        await adapter.resumeSession({
          sessionId: "local",
          externalSessionId,
          workspaceRoot: directory,
        });
        await adapter.send(
          "local",
          "seed-recall-run",
          "What code did I ask you to remember? Reply with only the code.",
        );
        const lastBody = JSON.stringify(model.requests.at(-1)?.body);
        expect(lastBody).toContain("ORANGE-42");
      } finally {
        await adapter.dispose();
        await model.close();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it.skipIf(process.env["RUN_REAL_DSH_SEED_SPIKE"] !== "1")(
    "appends a canonical delta to an existing session and recalls it",
    async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "pi-ling-seed-delta-"),
      );
      const dshHome = path.join(directory, "dsh-home");
      const externalSessionId = "seed-delta-session-1";

      const model = await startMockLlmServer({
        sequence: ["success", "success"],
        apiKey: "mock-key",
        successText: "recalled",
      });
      const adapter = new DshRuntimeAdapter({
        ...realDshOptions(dshHome, model),
        env: {
          DEEPSEEK_API_KEY: "mock-key",
          DEEPSEEK_BASE_URL: model.baseURL,
        },
      });
      try {
        await adapter.initialize();
        // Turn 1: seed the initial history.
        await adapter.importSession({
          sessionId: externalSessionId,
          workspaceRoot: directory,
          provider: "deepseek",
          model: "deepseek-v4-flash",
          canonicalMessages: canonicalHistory,
        });
        await adapter.resumeSession({
          sessionId: "local",
          externalSessionId,
          workspaceRoot: directory,
        });
        await adapter.send(
          "local",
          "delta-run-1",
          "What code? Reply with only the code.",
        );
        await adapter.closeSession("local");

        // Turn 2: append a delta and resume again.
        await adapter.importSession({
          sessionId: externalSessionId,
          appendToExternalSessionId: externalSessionId,
          startTurn: 2,
          workspaceRoot: directory,
          provider: "deepseek",
          model: "deepseek-v4-flash",
          canonicalMessages: [
            {
              id: "canonical-user-2",
              role: "user",
              sourceRuntime: "native",
              createdAt: 1,
              content: [{ type: "text", text: "My fruit is BANANA-99." }],
            },
            {
              id: "canonical-assistant-2",
              role: "assistant",
              sourceRuntime: "native",
              createdAt: 1,
              content: [{ type: "text", text: "I will remember that fruit." }],
            },
          ],
        });
        await adapter.resumeSession({
          sessionId: "local",
          externalSessionId,
          workspaceRoot: directory,
        });
        await adapter.send(
          "local",
          "delta-run-2",
          "What fruit? Reply with only the fruit.",
        );
        const lastBody = JSON.stringify(model.requests.at(-1)?.body);
        expect(lastBody).toContain("BANANA-99");
        expect(lastBody).toContain("ORANGE-42");
      } finally {
        await adapter.dispose();
        await model.close();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
