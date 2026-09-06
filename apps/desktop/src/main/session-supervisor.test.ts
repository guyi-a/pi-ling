import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeEventListener,
  RuntimeSessionOptions,
} from "@pi-ling/runtime-contracts";

import { SessionStore } from "./session-store/session-store.js";
import { SessionSupervisor } from "./session-supervisor.js";

class FakeDshRuntime implements RuntimeAdapter {
  readonly kind = "dsh" as const;
  readonly capabilities = {} as RuntimeCapabilities;
  readonly listeners = new Set<RuntimeEventListener>();
  async initialize() {}
  async createSession(options: RuntimeSessionOptions) {
    return {
      sessionId: options.sessionId,
      externalSessionId: "remote-session",
    };
  }
  resumeSession(options: RuntimeSessionOptions) {
    return this.createSession(options);
  }
  async send() {}
  async cancel() {}
  async resolvePermission() {
    return true;
  }
  async closeSession() {}
  subscribe(listener: RuntimeEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async dispose() {}
}

describe("SessionSupervisor", () => {
  let root = "";
  let store: SessionStore;
  let supervisor: SessionSupervisor;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-supervisor-"));
    store = new SessionStore(path.join(root, "sessions.db"));
    supervisor = new SessionSupervisor(store, () => {});
  });

  afterEach(async () => {
    await supervisor.dispose();
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("creates, switches and isolates session snapshots", async () => {
    const first = await supervisor.create({
      workspaceRoot: root,
      title: "First",
    });
    store.appendTimeline(first.session.id, "run-1", {
      type: "run_start",
      userItemId: "run-1:user",
      prompt: "first",
    });
    const second = await supervisor.create({
      workspaceRoot: root,
      title: "Second",
    });

    expect(supervisor.list().map((session) => session.title)).toEqual([
      "Second",
      "First",
    ]);
    expect(second.snapshot.events).toHaveLength(0);

    const restored = await supervisor.activate(first.session.id);
    expect(restored.snapshot.events).toHaveLength(1);
    expect(restored.snapshot.events[0]?.event).toMatchObject({
      type: "run_start",
      prompt: "first",
    });
  });

  it("switches runtime in place without creating another session", async () => {
    await supervisor.dispose();
    supervisor = new SessionSupervisor(
      store,
      () => {},
      new FakeDshRuntime(),
    );
    const created = await supervisor.create({
      workspaceRoot: root,
      runtimeKind: "native",
    });
    const switched = await supervisor.switchRuntime("dsh");

    expect(switched.session.id).toBe(created.session.id);
    expect(switched.session.runtimeKind).toBe("dsh");
    expect(supervisor.list()).toHaveLength(1);
  });
});
