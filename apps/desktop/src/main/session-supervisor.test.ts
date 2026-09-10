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
  readonly closed: string[] = [];
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
  async closeSession(sessionId: string) {
    this.closed.push(sessionId);
  }
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

  it("includes background tasks when activating a session", async () => {
    const session = await supervisor.create({
      workspaceRoot: root,
      title: "Main",
    });
    store.createBackgroundTask({
      id: "task-1",
      parentSessionId: session.session.id,
      parentRunId: "run-1",
      parentToolCallId: "tool-call-1",
      description: "Scan sources",
    });
    const activated = await supervisor.activate(session.session.id);
    expect(activated.backgroundTasks).toEqual([
      expect.objectContaining({
        id: "task-1",
        parentToolCallId: "tool-call-1",
        status: "pending",
        description: "Scan sources",
      }),
    ]);
  });

  it("creates, switches and isolates session snapshots", async () => {
    const first = await supervisor.create({
      workspaceRoot: root,
      title: "First",
    });
    store.appendSessionEvent({
      sessionId: first.session.id,
      runtimeKind: "native",
      runId: "run-1",
      messageId: "run-1:user",
      idempotencyKey: "run:run-1:start",
      event: {
        kind: "run.started",
        userMessage: {
          id: "run-1:user",
          role: "user",
          content: [{ type: "text", text: "first" }],
          sourceRuntime: "native",
          createdAt: 1,
        },
      },
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

  it("keeps empty workspaces and activates the next session on archive", async () => {
    const empty = supervisor.addWorkspace(path.join(root, "empty"));
    expect(supervisor.listWorkspaces()).toEqual([
      expect.objectContaining({ id: empty.id, sessions: [] }),
    ]);

    const first = await supervisor.create({
      workspaceRoot: root,
      title: "First",
    });
    const second = await supervisor.create({
      workspaceId: first.session.workspaceId,
      title: "Second",
    });
    supervisor.setSessionPinned(first.session.id, true);

    const archived = await supervisor.archiveSession(second.session.id);
    expect(archived.activation?.session.id).toBe(first.session.id);
    expect(
      supervisor.listWorkspaces(true).find(
        (workspace) => workspace.id === first.session.workspaceId,
      )?.sessions,
    ).toEqual([
      expect.objectContaining({ id: first.session.id, pinnedAt: expect.any(Number) }),
      expect.objectContaining({ id: second.session.id, archivedAt: expect.any(Number) }),
    ]);
    supervisor.restoreSession(second.session.id);
    expect(supervisor.list()).toHaveLength(2);
  });

  it("leaves unavailable DSH history intact during startup", async () => {
    const session = store.createSession({
      workspaceRoot: root,
      runtimeKind: "dsh",
    });
    await supervisor.initialize();
    expect(supervisor.status.sessionId).toBeUndefined();
    expect(store.getSession(session.id)?.lifecycle).toBe("idle");
  });

  it("switches selected sessions without closing background runtimes", async () => {
    await supervisor.dispose();
    const runtime = new FakeDshRuntime();
    supervisor = new SessionSupervisor(
      store,
      () => {},
      () => {},
      runtime,
    );
    const first = await supervisor.create({
      workspaceRoot: root,
      runtimeKind: "dsh",
      title: "First",
    });
    const second = await supervisor.create({
      workspaceId: first.session.workspaceId,
      runtimeKind: "dsh",
      title: "Second",
    });
    await supervisor.activate(first.session.id);
    await supervisor.activate(second.session.id);

    expect(runtime.closed).toEqual([]);
    expect((await supervisor.activate(first.session.id)).activationRevision)
      .toBeGreaterThan(second.activationRevision);

    await supervisor.activate(first.session.id);
    supervisor.startPrompt("run-first", "work", first.session.id);
    await supervisor.activate(second.session.id);
    expect(() =>
      supervisor.startPrompt("run-second", "conflict", second.session.id),
    ).toThrow(/already running in this workspace/);

    const third = await supervisor.create({
      workspaceRoot: path.join(root, "other"),
      runtimeKind: "dsh",
      title: "Third",
    });
    expect(() =>
      supervisor.startPrompt("run-third", "parallel", third.session.id),
    ).not.toThrow();
  });
});
