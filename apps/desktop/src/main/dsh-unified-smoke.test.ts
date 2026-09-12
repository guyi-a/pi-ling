import { execFileSync } from "node:child_process";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  startMockLlmServer,
  type MockLlmServer,
} from "@deepseek-ai/dsh-llm-mock-server";
import {
  DshRuntimeAdapter,
  type DshRuntimeOptions,
} from "@pi-ling/dsh-runtime";
import type { RuntimeEvent } from "@pi-ling/runtime-contracts";
import { describe, expect, it } from "vitest";

import { DSH_PI_AI_PROFILE_PATCH } from "./dsh-pi-ai-profile.js";
import { SessionStore } from "./session-store/session-store.js";
import { SessionSupervisor } from "./session-supervisor.js";

const EXPECTED_DSH_COMMIT =
  "d347e703908d0406b7a7ef80e3a0e594d86b2215";
const EXPECTED_DSH_VERSION = "0.1.3-alpha.1";
const EXPECTED_ACP_SDK = "1.4.0";
const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const projectEnv = path.join(projectRoot, ".env");

function loadProjectEnv(): void {
  if (existsSync(projectEnv)) process.loadEnvFile(projectEnv);
}

function realDshOptions(
  dshHome: string,
  model: { baseURL?: string; apiKey?: string } = {},
): DshRuntimeOptions {
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
  const acpManifest = JSON.parse(
    readFileSync(
      path.join(sourceRoot, "packages", "acp", "acp", "package.json"),
      "utf8",
    ),
  ) as {
    version?: unknown;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const commit = execFileSync(
    "git",
    ["-C", sourceRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const acpSdk =
    acpManifest.dependencies?.["@agentclientprotocol/sdk"] ??
    acpManifest.devDependencies?.["@agentclientprotocol/sdk"];
  expect(commit).toBe(EXPECTED_DSH_COMMIT);
  expect(rootManifest.version).toBe(EXPECTED_DSH_VERSION);
  expect(acpManifest.version).toBe(EXPECTED_DSH_VERSION);
  expect(acpSdk).toBe(EXPECTED_ACP_SDK);
  expect(existsSync(dshBin)).toBe(true);
  expect(existsSync(command)).toBe(true);
  const apiKey =
    model.apiKey ?? process.env["DEEPSEEK_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error(
      "Real DSH smoke requires DEEPSEEK_API_KEY in the environment or .env",
    );
  }
  console.info(
    JSON.stringify({
      scenario: "pi-ling-real-dsh",
      dshCommit: commit,
      dshVersion: rootManifest.version,
      acpSdk,
      node: process.versions.node,
      provider: "deepseek",
      model: "deepseek-flash",
      backend: model.baseURL ? "local-mock" : "configured-provider",
    }),
  );
  return {
    dshBin,
    command,
    dshHome,
    cwd: sourceRoot,
    profilePatch: DSH_PI_AI_PROFILE_PATCH,
    env: {
      DEEPSEEK_API_KEY: apiKey,
      ...(model.baseURL ? { DEEPSEEK_BASE_URL: model.baseURL } : {}),
    },
  };
}

describe.sequential("real DSH unified session smoke", () => {
  it.skipIf(process.env["RUN_REAL_DSH_UNIFIED_SMOKE"] !== "1")(
    "persists a real DSH prompt as canonical session events",
    async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "pi-ling-dsh-unified-"),
      );
      const model = await startMockLlmServer({
        sequence: ["success"],
        apiKey: "mock-key",
        successText: "unified-dsh-ok",
      });
      const runtime = new DshRuntimeAdapter(
        realDshOptions(path.join(directory, "dsh-home"), {
          baseURL: model.baseURL,
          apiKey: "mock-key",
        }),
      );
      const store = new SessionStore(path.join(directory, "pi-ling.db"));
      const supervisor = new SessionSupervisor(
        store,
        () => {},
        () => {},
        runtime,
      );
      try {
        const activation = await supervisor.create({
          workspaceRoot: directory,
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
        await model.close();
        store.close();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
    90_000,
  );

  it.skipIf(process.env["RUN_REAL_DSH_LIFECYCLE_SMOKE"] !== "1")(
    "creates, prompts, cancels, closes, and resumes across processes",
    async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "pi-ling-dsh-lifecycle-"),
      );
      const dshHome = path.join(directory, "dsh-home");
      const productSessionId = "lifecycle-session";
      const firstModel: MockLlmServer = await startMockLlmServer({
        sequence: ["success", "stall"],
        apiKey: "mock-key",
        successText: "remembered",
      });
      const firstEvents: RuntimeEvent[] = [];
      const first = new DshRuntimeAdapter(
        realDshOptions(dshHome, {
          baseURL: firstModel.baseURL,
          apiKey: "mock-key",
        }),
      );
      first.subscribe((event) => {
        firstEvents.push(event);
      });
      let externalSessionId = "";
      try {
        const handle = await first.createSession({
          sessionId: productSessionId,
          workspaceRoot: directory,
        });
        externalSessionId = handle.externalSessionId;
        await first.send(
          productSessionId,
          "lifecycle-first",
          "Remember the code ACP-BASELINE-17. Reply only: remembered",
        );
        expect(
          firstEvents
            .filter((event) => event.type === "assistant_text")
            .map((event) => event.delta)
            .join(""),
        ).toContain("remembered");

        const cancelling = first.send(
          productSessionId,
          "lifecycle-cancel",
          "Write a very long explanation of every integer from 1 to 10000.",
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await first.cancel(productSessionId);
        await cancelling;
        expect(firstEvents.at(-1)).toMatchObject({
          type: "run_end",
          runId: "lifecycle-cancel",
          status: "cancelled",
        });
        await first.closeSession(productSessionId);
      } finally {
        await first.dispose();
        await firstModel.close();
      }

      const resumedModel = await startMockLlmServer({
        sequence: ["success"],
        apiKey: "mock-key",
        successText: "ACP-BASELINE-17",
      });
      const resumedEvents: RuntimeEvent[] = [];
      const resumed = new DshRuntimeAdapter(
        realDshOptions(dshHome, {
          baseURL: resumedModel.baseURL,
          apiKey: "mock-key",
        }),
      );
      resumed.subscribe((event) => {
        resumedEvents.push(event);
      });
      try {
        await resumed.resumeSession({
          sessionId: productSessionId,
          externalSessionId,
          workspaceRoot: directory,
        });
        await resumed.send(
          productSessionId,
          "lifecycle-resumed",
          "What code did I ask you to remember? Reply with only the code.",
        );
        expect(
          resumedEvents
            .filter((event) => event.type === "assistant_text")
            .map((event) => event.delta)
            .join(""),
        ).toContain("ACP-BASELINE-17");
        expect(
          JSON.stringify(resumedModel.requests.at(-1)?.body),
        ).toContain("ACP-BASELINE-17");
        expect(
          JSON.stringify(resumedModel.requests.at(-1)?.body),
        ).toContain("remembered");
      } finally {
        await resumed.dispose();
        await resumedModel.close();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it.skipIf(process.env["RUN_REAL_DSH_APPROVAL_SMOKE"] !== "1")(
    "gates a real DSH write through pi-ling approval",
    async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "pi-ling-dsh-approval-"),
      );
      const model = await startMockLlmServer({
        sequence: ["tool_call_success", "success"],
        apiKey: "mock-key",
        toolName: "write",
        toolArguments: JSON.stringify({
          file_path: "approval.txt",
          content: "approved",
        }),
        successText: "write-complete",
      });
      const runtime = new DshRuntimeAdapter(
        realDshOptions(path.join(directory, "dsh-home"), {
          baseURL: model.baseURL,
          apiKey: "mock-key",
        }),
      );
      let pending:
        | { callId: string; effectDigest: string }
        | undefined;
      const store = new SessionStore(path.join(directory, "pi-ling.db"));
      const supervisor = new SessionSupervisor(
        store,
        (envelope) => {
          if (envelope.event.type === "approval_requested") {
            pending = {
              callId: envelope.event.approval.callId,
              effectDigest: envelope.event.approval.effectDigest,
            };
          }
        },
        () => {},
        runtime,
      );
      try {
        const activation = await supervisor.create({
          workspaceRoot: directory,
          runtimeKind: "dsh",
        });
        supervisor.startPrompt(
          "real-dsh-approval",
          "Write approval.txt with the exact text approved, then reply briefly.",
          activation.session.id,
        );
        const deadline = Date.now() + 30_000;
        while (!pending) {
          if (Date.now() > deadline) {
            throw new Error("DSH approval request timed out");
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(existsSync(path.join(directory, "approval.txt"))).toBe(false);
        const decision = pending;
        await expect(
          supervisor.resolveApproval(decision.callId, {
            approved: true,
            effectDigest: decision.effectDigest,
          }),
        ).resolves.toBe(true);
        while (
          store.getSession(activation.session.id)?.lifecycle !== "idle"
        ) {
          if (Date.now() > deadline) {
            throw new Error("DSH approved write timed out");
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await expect(
          fs.readFile(path.join(directory, "approval.txt"), "utf8"),
        ).resolves.toBe("approved");
      } finally {
        await supervisor.dispose();
        await runtime.dispose();
        store.close();
        await model.close();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
