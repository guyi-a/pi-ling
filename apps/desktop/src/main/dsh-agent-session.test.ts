import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimePermissionDecision,
  RuntimeSessionHandle,
  RuntimeSessionOptions,
} from "@pi-ling/runtime-contracts";
import type { TimelineEnvelope } from "@pi-ling/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DshAgentSession } from "./dsh-agent-session.js";
import { RunMessageBuffer } from "./run-message-buffer.js";
import { SessionStore } from "./session-store/session-store.js";

class FakeDshRuntime implements RuntimeAdapter {
  readonly kind = "dsh" as const;
  readonly capabilities = {} as RuntimeCapabilities;
  readonly listeners = new Set<RuntimeEventListener>();
  permission?: RuntimePermissionDecision;

  async initialize() {}
  async createSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    return { sessionId: options.sessionId, externalSessionId: "remote-1" };
  }
  resumeSession(options: RuntimeSessionOptions) {
    return this.createSession(options);
  }
  async send(sessionId: string, runId: string) {
    await this.emit({ type: "run_start", sessionId, runId });
    await this.emit({
      type: "assistant_thought",
      sessionId,
      runId,
      delta: "think",
    });
    await this.emit({
      type: "tool",
      sessionId,
      runId,
      callId: "call-1",
      title: "Read file",
      kind: "read",
      status: "running",
      input: { path: "a.txt" },
    });
    await this.emit({
      type: "tool",
      sessionId,
      runId,
      callId: "call-1",
      title: "Read file",
      status: "completed",
      output: "ok",
    });
    await this.emit({
      type: "assistant_text",
      sessionId,
      runId,
      delta: "done",
    });
    await this.emit({
      type: "run_end",
      sessionId,
      runId,
      status: "completed",
    });
  }
  async cancel() {}
  async resolvePermission(decision: RuntimePermissionDecision) {
    this.permission = decision;
    return true;
  }
  async closeSession() {}
  subscribe(listener: RuntimeEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async dispose() {}
  async emit(event: RuntimeEvent) {
    for (const listener of this.listeners) await listener(event);
  }
}

describe("DshAgentSession", () => {
  let directory = "";
  let store: SessionStore;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-dsh-map-"));
    store = new SessionStore(path.join(directory, "sessions.db"));
  });

  afterEach(async () => {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("maps DSH updates to ordered pi-ling timeline events", async () => {
    const summary = store.createSession({
      workspaceRoot: directory,
      runtimeKind: "dsh",
      runtimeVersion: "0.1.3-alpha.1",
    });
    const runtime = new FakeDshRuntime();
    const buffer = new RunMessageBuffer(() => {});
    const emitted: TimelineEnvelope[] = [];
    const session = await DshAgentSession.open({
      store,
      session: summary,
      runtime,
      emit: (event) => emitted.push(event),
      buffer,
      availableRuntimes: ["native", "dsh"],
    });
    session.startPrompt("run-1", "inspect");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getRuntimeSessionId(summary.id)).toBe("remote-1");
    expect(
      session.snapshot().events.map(({ event }) => event.type),
    ).toEqual([
      "run_start",
      "turn_start",
      "assistant_start",
      "assistant_thinking_delta",
      "assistant_end",
      "tool_requested",
      "tool_start",
      "tool_end",
      "turn_start",
      "assistant_start",
      "assistant_text_delta",
      "assistant_end",
      "run_end",
    ]);
    expect(
      store
        .loadSnapshot(summary.id)
        .events.some(
          ({ event }) =>
            event.type === "assistant_text_delta" ||
            event.type === "assistant_thinking_delta",
        ),
    ).toBe(false);
    expect(JSON.stringify(store.loadSessionEvents(summary.id))).toContain(
      "done",
    );
    expect(emitted[0]?.event).toMatchObject({
      type: "run_start",
      prompt: "inspect",
    });
    expect(emitted.map(({ seq }) => seq)).toEqual(
      emitted.map((_, index) => index + 1),
    );
    await session.dispose();
  });
});
