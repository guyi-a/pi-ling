import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeEvent } from "@pi-ling/runtime-contracts";
import { afterEach, describe, expect, it } from "vitest";

import { DshRuntimeAdapter } from "../src/index.js";

const fixture = fileURLToPath(new URL("./fake-acp-agent.mjs", import.meta.url));
const runtimes: DshRuntimeAdapter[] = [];

function runtime(env: Record<string, string> = {}) {
  const value = new DshRuntimeAdapter({
    dshHome: process.cwd(),
    command: process.execPath,
    args: [fixture],
    env,
  });
  runtimes.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((value) => value.dispose()));
});

describe("DshRuntimeAdapter", () => {
  it("maps ACP updates into runtime events", async () => {
    const adapter = runtime({ FAKE_TEXT: "hello" });
    const events: RuntimeEvent[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });
    await adapter.createSession({
      sessionId: "local",
      workspaceRoot: process.cwd(),
    });
    await adapter.send("local", "run-1", "say hello");

    expect(events.map((event) => event.type)).toEqual([
      "run_start",
      "assistant_thought",
      "tool",
      "tool",
      "assistant_text",
      "run_end",
    ]);
    expect(events).toContainEqual({
      type: "assistant_text",
      sessionId: "local",
      runId: "run-1",
      delta: "hello",
    });
  });

  it("materializes a profile patch for the pinned ACP process", async () => {
    const dshHome = await fs.mkdtemp(
      path.join(os.tmpdir(), "pi-ling-dsh-profile-"),
    );
    const adapter = new DshRuntimeAdapter({
      dshHome,
      command: process.execPath,
      dshBin: fixture,
      profilePatch: "- id: llm-pi-ai\n",
    });
    runtimes.push(adapter);
    try {
      await adapter.createSession({
        sessionId: "profile",
        workspaceRoot: process.cwd(),
      });
      await expect(
        fs.readFile(path.join(dshHome, "pi-ling-acp.patch.yml"), "utf8"),
      ).resolves.toBe("- id: llm-pi-ai\n");
    } finally {
      await fs.rm(dshHome, { recursive: true, force: true });
    }
  });

  it("round-trips one-shot permission decisions", async () => {
    const adapter = runtime({ FAKE_PERMISSION: "1" });
    let sawPermission = false;
    adapter.subscribe(async (event) => {
      if (event.type !== "permission") return;
      sawPermission = true;
      await adapter.resolvePermission({
        permissionId: event.permissionId,
        optionId: "allow",
      });
    });
    await adapter.createSession({
      sessionId: "local",
      workspaceRoot: process.cwd(),
    });
    await adapter.send("local", "run-1", "write");
    expect(sawPermission).toBe(true);
  });

  it("cancels an in-flight ACP prompt", async () => {
    const adapter = runtime({ FAKE_HANG: "1" });
    const events: RuntimeEvent[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });
    await adapter.createSession({
      sessionId: "local",
      workspaceRoot: process.cwd(),
    });
    const sending = adapter.send("local", "run-1", "wait");
    while (!events.some((event) => event.type === "assistant_text")) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await adapter.cancel("local");
    await sending;
    expect(events.at(-1)).toMatchObject({
      type: "run_end",
      status: "cancelled",
    });
  });

  it("reports child crashes without crashing the host", async () => {
    const adapter = runtime({ FAKE_CRASH: "1" });
    const events: RuntimeEvent[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });
    await adapter.createSession({
      sessionId: "local",
      workspaceRoot: process.cwd(),
    });
    await expect(
      adapter.send("local", "run-crash", "crash"),
    ).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events.some((event) => event.type === "runtime_error")).toBe(true);
  });
});
