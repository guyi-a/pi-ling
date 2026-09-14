import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeEventListener,
  RuntimeSessionImportOptions,
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

class FakeCodexRuntime extends FakeDshRuntime {
  readonly kind = "codex" as const;
  setSessionOptions(_sessionId: string, _options: unknown) {}
  async importSession(options: RuntimeSessionImportOptions) {
    return {
      externalSessionId:
        options.appendToExternalSessionId ?? options.sessionId,
    };
  }
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

  it("switches to codex runtime in place", async () => {
    await supervisor.dispose();
    supervisor = new SessionSupervisor(
      store,
      () => {},
      () => {},
      undefined,
      new FakeCodexRuntime(),
    );
    const created = await supervisor.create({
      workspaceRoot: root,
      runtimeKind: "native",
    });
    const switched = await supervisor.switchRuntime("codex");
    expect(switched.session.id).toBe(created.session.id);
    expect(switched.session.runtimeKind).toBe("codex");
  });

  it("switches runtime in place without creating another session", async () => {
    await supervisor.dispose();
    supervisor = new SessionSupervisor(
      store,
      () => {},
      () => {},
      new FakeDshRuntime(),
      undefined,
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
      undefined,
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

describe("SessionSupervisor.diffFileContents", () => {
  let root = "";
  let store: SessionStore;
  let supervisor: SessionSupervisor;

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });

  async function initRepo(): Promise<void> {
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    git("config", "commit.gpgsign", "false");
  }

  async function commitAll(message: string): Promise<void> {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-diffcontents-"));
    store = new SessionStore(path.join(root, "sessions.db"));
    supervisor = new SessionSupervisor(store, () => {});
    await initRepo();
  });

  afterEach(async () => {
    await supervisor.dispose();
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns both sides for a modified file in the uncommitted scope", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "const v = 1;\n");
    await commitAll("init");
    await fs.writeFile(path.join(root, "a.ts"), "const v = 2;\n");
    await supervisor.create({ workspaceRoot: root, title: "Main" });

    const contents = await supervisor.diffFileContents("a.ts", "uncommitted");
    expect(contents).toEqual({
      path: "a.ts",
      before: "const v = 1;\n",
      after: "const v = 2;\n",
    });
  });

  it("treats an added file as having an empty before side", async () => {
    await fs.writeFile(path.join(root, "seed.txt"), "seed\n");
    await commitAll("init");
    await fs.writeFile(path.join(root, "new.ts"), "brand new\n");
    await supervisor.create({ workspaceRoot: root, title: "Main" });

    const contents = await supervisor.diffFileContents("new.ts", "uncommitted");
    expect(contents).toEqual({
      path: "new.ts",
      before: "",
      after: "brand new\n",
    });
  });

  it("treats a deleted file as having an empty after side", async () => {
    await fs.writeFile(path.join(root, "gone.ts"), "bye\n");
    await commitAll("init");
    await fs.rm(path.join(root, "gone.ts"));
    await supervisor.create({ workspaceRoot: root, title: "Main" });

    const contents = await supervisor.diffFileContents("gone.ts", "uncommitted");
    expect(contents).toEqual({
      path: "gone.ts",
      before: "bye\n",
      after: "",
    });
  });

  it("reads index as the after side for the staged scope", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "v1\n");
    await commitAll("init");
    await fs.writeFile(path.join(root, "a.ts"), "v2\n");
    git("add", "a.ts");
    await supervisor.create({ workspaceRoot: root, title: "Main" });

    const contents = await supervisor.diffFileContents("a.ts", "staged");
    expect(contents).toEqual({ path: "a.ts", before: "v1\n", after: "v2\n" });
  });

  it("reads index as the before side for the unstaged scope", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "v1\n");
    await commitAll("init");
    await fs.writeFile(path.join(root, "a.ts"), "v2\n");
    git("add", "a.ts");
    await fs.writeFile(path.join(root, "a.ts"), "v3\n");
    await supervisor.create({ workspaceRoot: root, title: "Main" });

    const contents = await supervisor.diffFileContents("a.ts", "unstaged");
    expect(contents).toEqual({ path: "a.ts", before: "v2\n", after: "v3\n" });
  });

  it("refuses sensitive files instead of leaking their contents", async () => {
    await fs.writeFile(path.join(root, ".env"), "TOKEN=old\n");
    await commitAll("init");
    await fs.writeFile(path.join(root, ".env"), "TOKEN=new\n");
    await supervisor.create({ workspaceRoot: root, title: "Main" });

    expect(
      await supervisor.diffFileContents(".env", "uncommitted"),
    ).toBeUndefined();
  });

  it("refuses tracked binary files rather than rendering an empty diff", async () => {
    await fs.writeFile(
      path.join(root, "logo.bin"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]),
    );
    await commitAll("init");
    await fs.writeFile(
      path.join(root, "logo.bin"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0xfd]),
    );
    await supervisor.create({ workspaceRoot: root, title: "Main" });

    expect(
      await supervisor.diffFileContents("logo.bin", "uncommitted"),
    ).toBeUndefined();
  });

  it("returns undefined for a path that is not in the change set", async () => {
    await fs.writeFile(path.join(root, "a.ts"), "v1\n");
    await commitAll("init");
    await supervisor.create({ workspaceRoot: root, title: "Main" });

    expect(
      await supervisor.diffFileContents("a.ts", "uncommitted"),
    ).toBeUndefined();
  });

  it("returns undefined when the workspace is not a git repository", async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-nogit-"));
    try {
      await fs.writeFile(path.join(plain, "a.ts"), "x\n");
      await supervisor.create({ workspaceRoot: plain, title: "Plain" });
      expect(
        await supervisor.diffFileContents("a.ts", "uncommitted"),
      ).toBeUndefined();
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });
});
