import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionStore } from "../session-store/session-store.js";
import { TaskRunner } from "./task-runner.js";

describe("TaskRunner", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      try {
        fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
      } catch {
        // Windows can keep sqlite handles open briefly after close().
      }
    }
  });

  it("executes a background subagent and publishes terminal updates", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ling-task-"));
    tempDirs.push(directory);
    const store = new SessionStore(path.join(directory, "session.db"));
    const session = store.createSession({ workspaceRoot: directory });
    const onUpdated = vi.fn();
    const onTerminal = vi.fn(async () => {});
    const runner = new TaskRunner({
      store,
      concurrency: 1,
      onUpdated,
      onTerminal,
    });
    await runner.start();

    const task = runner.submitSubagent({
      parentSessionId: session.id,
      parentRunId: "run-1",
      parentToolCallId: "tool-1",
      description: "Explore auth",
      spec: {
        type: "explore",
        mode: "background",
        description: "Explore auth",
        prompt: "Find auth entrypoints.",
      },
      execute: async () => ({ summary: "Auth lives in src/auth.ts" }),
    });

    await vi.waitFor(() => expect(onTerminal).toHaveBeenCalled());
    const terminal = onTerminal.mock.calls.at(-1)?.[0];
    expect(terminal?.id).toBe(task.id);
    expect(terminal?.status).toBe("completed");
    expect(terminal?.summary).toBe("Auth lives in src/auth.ts");
    await runner.shutdown();
    store.close();
  });
});
