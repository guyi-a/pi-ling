import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RuntimeEvent } from "@pi-ling/runtime-contracts";
import { afterEach, describe, expect, it } from "vitest";

import { shouldAskBeforeDshTool } from "../src/dsh-approval-policy.js";
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
      "context_usage",
      "run_end",
    ]);
    expect(events).toContainEqual({
      type: "assistant_text",
      sessionId: "local",
      runId: "run-1",
      executionGroupId: "run-1:exec",
      messageId: "msg-answer-1",
      delta: "hello",
    });
    expect(events).toContainEqual({
      type: "context_usage",
      sessionId: "local",
      runId: "run-1",
      used: 8700,
      size: 1_000_000,
    });
  });

  it("declares only verified DSH capabilities", () => {
    const adapter = runtime();
    expect(adapter.capabilities).toEqual({
      modelSwitching: false,
      partialStreaming: false,
      toolApproval: true,
      mcp: false,
      hooks: false,
      sandbox: true,
      subagents: false,
      resume: true,
      fork: false,
      fileCheckpoint: false,
    });
  });

  it("treats resume of an already active DSH session as success", async () => {
    const remoteSessionId = "remote-session-active";
    const adapter = runtime({ FAKE_SESSION_ID: remoteSessionId });
    const created = await adapter.createSession({
      sessionId: "local-a",
      workspaceRoot: process.cwd(),
    });
    const resumed = await adapter.resumeSession({
      sessionId: "local-b",
      workspaceRoot: process.cwd(),
      externalSessionId: created.externalSessionId,
    });
    expect(resumed.externalSessionId).toBe(remoteSessionId);
  });

  it("creates a fresh session when resume hits a non-resumable id", async () => {
    const adapter = runtime();
    const recovered = await adapter.resumeSession({
      sessionId: "local-stale",
      workspaceRoot: process.cwd(),
      externalSessionId: "stale-dsh-session",
    });
    expect(recovered.externalSessionId).not.toBe("stale-dsh-session");
    expect(recovered.externalSessionId).toBeTruthy();
  });

  it("resumes a closed session with the original external id", async () => {
    const remoteSessionId = "remote-session-42";
    const adapter = runtime({ FAKE_SESSION_ID: remoteSessionId });
    const created = await adapter.createSession({
      sessionId: "local",
      workspaceRoot: process.cwd(),
    });
    expect(created.externalSessionId).toBe(remoteSessionId);
    await adapter.closeSession("local");
    const resumed = await adapter.resumeSession({
      sessionId: "local",
      workspaceRoot: process.cwd(),
      externalSessionId: remoteSessionId,
    });
    expect(resumed.externalSessionId).toBe(remoteSessionId);
    const events: RuntimeEvent[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });
    await adapter.send("local", "run-resume", "resume");
    expect(events.some((event) => event.type === "run_end")).toBe(true);
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
      const patch = await fs.readFile(
        path.join(dshHome, "pi-ling-acp.patch.yml"),
        "utf8",
      );
      expect(patch).toContain("- id: llm-pi-ai");
      expect(patch).toContain("- id: pi-ling-approval-policy");
      expect(patch).toContain("dsh-approval-policy.js");
      expect(patch).toContain("- id: pi-ling-session-import");
      expect(patch).toContain("dsh-session-import.js");
    } finally {
      await fs.rm(dshHome, { recursive: true, force: true });
    }
  });

  it("asks for effects and delegates reads or native escalations", () => {
    expect(
      shouldAskBeforeDshTool({ name: "read", arguments: { file_path: "a" } }),
    ).toBe(false);
    expect(
      shouldAskBeforeDshTool({ name: "write", arguments: { file_path: "a" } }),
    ).toBe(true);
    expect(
      shouldAskBeforeDshTool({ name: "bash", arguments: { command: "pwd" } }),
    ).toBe(true);
    expect(
      shouldAskBeforeDshTool({ name: "new-tool", arguments: {} }),
    ).toBe(true);
    expect(
      shouldAskBeforeDshTool({
        name: "write",
        arguments: {
          file_path: "outside",
          sandbox_permissions: "danger-full-access",
          justification: "required",
        },
      }),
    ).toBe(false);
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

  it("enriches sparse permission requests from prior tool updates", async () => {
    const adapter = runtime({
      FAKE_PERMISSION: "1",
      FAKE_PERMISSION_SPARSE: "1",
    });
    let permission:
      | Extract<RuntimeEvent, { type: "permission" }>
      | undefined;
    adapter.subscribe(async (event) => {
      if (event.type !== "permission") return;
      permission = event;
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

    expect(permission).toMatchObject({
      title: "write",
      toolKind: "edit",
      input: { file_path: ".env", content: "API_KEY=secret" },
    });
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
