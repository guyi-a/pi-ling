import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  deleteSession,
  query,
  type SDKMessage,
  type SDKUserMessage,
  type SessionKey,
  type SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteClaudeSessionStore } from "../src/index.js";

const artifactDirectory = fileURLToPath(
  new URL("../../../.artifacts/claude-transcript-poc/", import.meta.url),
);

describe("Claude transcript SQLite mirror", () => {
  let directory = "";
  let store: SqliteClaudeSessionStore;

  beforeEach(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "pi-ling-claude-transcript-"),
    );
    store = new SqliteClaudeSessionStore(
      path.join(directory, "claude-transcript.db"),
    );
  });

  afterEach(async () => {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("round-trips opaque transcript entries and deduplicates UUIDs", async () => {
    const key: SessionKey = {
      projectKey: "project",
      sessionId: "session",
    };
    const entries: SessionStoreEntry[] = [
      { type: "user", uuid: "message-1", message: { content: "hello" } },
      { type: "metadata", mode: "default" },
    ];
    await store.append(key, entries);
    await store.append(key, [entries[0]!]);

    expect(await store.load(key)).toEqual(entries);
    expect(await store.listSessions("project")).toHaveLength(1);
    expect(store.mirroredSessions()).toEqual([
      { projectKey: "project", sessionId: "session", entries: 2 },
    ]);
  });

  it.skipIf(process.env["RUN_REAL_CLAUDE_TRANSCRIPT_POC"] !== "1")(
    "mirrors a real session and injects canonical context without an extra turn",
    async () => {
      const sessionId = randomUUID();
      const cwd = "E:/pi-ling";
      const canonicalCode = "VIOLET-73";
      let firstAnswer = "";
      let resumedAnswer = "";
      await fs.mkdir(artifactDirectory, { recursive: true });

      async function* prompt(): AsyncIterable<SDKUserMessage> {
        yield {
          type: "user",
          uuid: randomUUID(),
          session_id: sessionId,
          parent_tool_use_id: null,
          shouldQuery: false,
          isSynthetic: true,
          message: {
            role: "user",
            content: `Canonical context: my test code is ${canonicalCode}.`,
          },
        };
        yield {
          type: "user",
          uuid: randomUUID(),
          session_id: sessionId,
          parent_tool_use_id: null,
          message: {
            role: "user",
            content:
              "What is my test code? Reply with only the code.",
          },
        };
      }

      function appendAssistantText(message: SDKMessage): string {
        if (message.type !== "assistant") return "";
        return message.message.content
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("");
      }

      try {
        for await (const message of query({
          prompt: prompt(),
          options: {
            cwd,
            sessionId,
            model: "claude-haiku-4-5-20251001",
            sessionStore: store,
            sessionStoreFlush: "eager",
            persistSession: true,
            tools: [],
            permissionMode: "dontAsk",
            maxTurns: 1,
            debugFile: path.join(artifactDirectory, "claude-first.log"),
            stderr: (data) => console.error(`[claude-poc] ${data}`),
          },
        })) {
          firstAnswer += appendAssistantText(message);
        }

        expect(firstAnswer).toContain(canonicalCode);
        expect(store.metrics.appendCalls).toBeGreaterThan(0);
        expect(
          store.mirroredSessions().some(
            (session) => session.sessionId === sessionId,
          ),
        ).toBe(true);

        const loadCallsBeforeResume = store.metrics.loadCalls;
        for await (const message of query({
          prompt:
            "Repeat the test code from our previous conversation. Reply with only the code.",
          options: {
            cwd,
            resume: sessionId,
            model: "claude-haiku-4-5-20251001",
            sessionStore: store,
            sessionStoreFlush: "eager",
            persistSession: true,
            tools: [],
            permissionMode: "dontAsk",
            maxTurns: 1,
            debugFile: path.join(artifactDirectory, "claude-resume.log"),
            stderr: (data) => console.error(`[claude-poc] ${data}`),
          },
        })) {
          resumedAnswer += appendAssistantText(message);
        }
        expect(resumedAnswer).toContain(canonicalCode);
        expect(store.metrics.loadCalls).toBeGreaterThan(loadCallsBeforeResume);
      } finally {
        await deleteSession(sessionId, { dir: cwd }).catch(() => {});
      }
    },
    120_000,
  );
});
