import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RuntimeEvent } from "@pi-ling/runtime-contracts";

import {
  ClaudeRuntimeAdapter,
  detectClaudeModelBackend,
  isClaudeRuntimeConfigured,
} from "../src/index.js";
import { loadRepoDotenv } from "./load-repo-dotenv.js";

loadRepoDotenv();

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

function hasAnthropicKey(): boolean {
  return Boolean(
    process.env["ANTHROPIC_API_KEY"]?.trim() ||
      process.env["ANTHROPIC_AUTH_TOKEN"]?.trim(),
  );
}

function hasDeepSeekKey(): boolean {
  return Boolean(process.env["DEEPSEEK_API_KEY"]?.trim());
}

async function runProbe(options: {
  preferDeepSeek?: boolean;
}): Promise<{
  backend: ReturnType<typeof detectClaudeModelBackend>;
  events: RuntimeEvent[];
  sendError: Error | undefined;
}> {
  const backend = detectClaudeModelBackend(process.env, options);
  const runtime = new ClaudeRuntimeAdapter({
    sessionStorePath: path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-claude-runtime-")),
      "claude-runtime.db",
    ),
    permissionMode: "dontAsk",
    maxTurns: 1,
    tools: [],
    stderr: (data) => {
      process.stderr.write(`[claude-runtime] ${data}`);
    },
    ...options,
  });

  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => {
    events.push(event);
  });

  const sessionId = randomUUID();
  const runId = randomUUID();

  await runtime.createSession({ sessionId, workspaceRoot });
  let sendError: Error | undefined;
  try {
    await runtime.send(
      sessionId,
      runId,
      "Reply with exactly the word PROBE_OK and nothing else.",
    );
  } catch (error) {
    sendError = error instanceof Error ? error : new Error(String(error));
  } finally {
    await runtime.dispose();
  }

  return { backend, events, sendError };
}

describe("Claude runtime probe", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "pi-ling-claude-runtime-"),
    );
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.skipIf(
    process.env["RUN_CLAUDE_PROBE"] !== "1" ||
      !isClaudeRuntimeConfigured() ||
      !hasAnthropicKey(),
  )(
    "anthropic: runs a one-turn prompt through ClaudeRuntimeAdapter",
    async () => {
      const { backend, events, sendError } = await runProbe({
        preferDeepSeek: false,
      });

      const assistantText = events
        .filter((event) => event.type === "assistant_text")
        .map((event) => event.delta)
        .join("");
      const runEnd = events.find((event) => event.type === "run_end");

      expect(sendError).toBeUndefined();
      expect(runEnd?.status).toBe("completed");
      expect(assistantText.toUpperCase()).toContain("PROBE");
      expect(backend).toBe("anthropic");
    },
    120_000,
  );

  it.skipIf(
    process.env["RUN_CLAUDE_PROBE_DEEPSEEK"] !== "1" || !hasDeepSeekKey(),
  )(
    "deepseek: documents Claude Code compatibility (fails until DeepSeek loop works)",
    async () => {
      const { backend, events, sendError } = await runProbe({
        preferDeepSeek: true,
      });

      const runEnd = events.find((event) => event.type === "run_end");
      expect(backend).toBe("deepseek");
      expect(runEnd?.status).toBe("error");
      expect(sendError?.message).toMatch(/DeepSeek Anthropic 兼容层/);
    },
    120_000,
  );
});
