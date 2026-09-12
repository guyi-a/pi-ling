import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Message } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionStore } from "./session-store.js";
import { SESSION_SCHEMA } from "./schema.js";

describe("SessionStore", () => {
  let directory = "";
  let store: SessionStore;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-db-"));
    store = new SessionStore(path.join(directory, "sessions.db"));
  });

  afterEach(async () => {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("migrates legacy claude runtime sessions to native", () => {
    const dbPath = path.join(directory, "legacy-claude.db");
    const db = new DatabaseSync(dbPath);
    db.exec(
      SESSION_SCHEMA.replace(
        "CHECK (runtime_kind IN ('native', 'dsh', 'codex'))",
        "CHECK (runtime_kind IN ('native', 'dsh', 'claude'))",
      ),
    );
    const now = Date.now();
    db.prepare(`
      INSERT INTO workspaces (
        workspace_id, root, root_key, name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run("ws-1", directory, directory.toLowerCase(), "Legacy", now, now);
    db.prepare(`
      INSERT INTO sessions (
        session_id, workspace_id, workspace_root, title, runtime_kind,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("session-claude", "ws-1", directory, "Claude", "claude", now, now);
    db.close();

    const legacyStore = new SessionStore(dbPath);
    expect(legacyStore.getSession("session-claude")?.runtimeKind).toBe(
      "native",
    );
    legacyStore.close();
  });

  it("creates, lists and deletes sessions", () => {
    const session = store.createSession({
      id: "session-1",
      workspaceRoot: directory,
      title: "Test",
    });
    expect(session.title).toBe("Test");
    expect(session.workspaceId).toBeTruthy();
    expect(session.approvalMode).toBe("manual");
    expect(session.composerMode).toBe("agent");
    expect(store.setApprovalMode(session.id, "auto").approvalMode).toBe(
      "auto",
    );
    expect(store.setComposerMode(session.id, "plan").composerMode).toBe("plan");
    expect(store.listSessions()).toHaveLength(1);
    store.deleteSession(session.id);
    expect(store.listSessions()).toHaveLength(0);
    expect(store.listWorkspaces()).toHaveLength(1);
  });

  it("registers a workspace once and keeps it without sessions", () => {
    const first = store.createWorkspace({ root: directory });
    const duplicate = store.createWorkspace({
      root: path.join(directory, "."),
    });
    expect(duplicate.id).toBe(first.id);
    expect(store.listWorkspaces()).toHaveLength(1);
    expect(store.listWorkspaces()[0]?.sessions).toEqual([]);
  });

  it("autotitles sessions from the first user message", () => {
    const session = store.createSession({
      id: "titled-session",
      workspaceRoot: directory,
    });
    expect(session.title).toBe("新对话");
    store.appendSessionEvent({
      sessionId: session.id,
      runtimeKind: "native",
      runId: "run-title",
      messageId: "user-title",
      idempotencyKey: "run:run-title:start",
      event: {
        kind: "run.started",
        userMessage: {
          id: "user-title",
          role: "user",
          content: [{ type: "text", text: "Fix the login bug" }],
          sourceRuntime: "native",
          createdAt: 1,
        },
      },
    });
    expect(store.getSession(session.id)?.title).toBe("Fix the login bug");
  });

  it("stores idempotent canonical events and runtime projections", () => {
    const session = store.createSession({
      id: "canonical-session",
      workspaceRoot: directory,
    });
    const input = {
      sessionId: session.id,
      runtimeKind: "native" as const,
      runId: "run",
      messageId: "user",
      idempotencyKey: "run:run:start",
      event: {
        kind: "run.started" as const,
        userMessage: {
          id: "user",
          role: "user" as const,
          content: [{ type: "text" as const, text: "hello" }],
          sourceRuntime: "native" as const,
          createdAt: 1,
        },
      },
    };
    expect(store.appendSessionEvent(input).seq).toBe(1);
    expect(store.appendSessionEvent(input).seq).toBe(1);
    expect(store.loadSessionEvents(session.id)).toHaveLength(1);
    expect(store.getRuntimeSession(session.id, "native")).toMatchObject({
      runtimeStatus: "detached",
    });

    store.appendRuntimeProjection({
      sessionId: session.id,
      runtimeKind: "native",
      entryUuid: "opaque-1",
      entry: { type: "opaque" },
    });
    expect(store.loadRuntimeProjection(session.id, "native")).toEqual([
      { type: "opaque" },
    ]);
  });

  it("pins, archives and restores sessions without deleting history", () => {
    const first = store.createSession({
      id: "first",
      workspaceRoot: directory,
      title: "First",
    });
    const second = store.createSession({
      id: "second",
      workspaceId: first.workspaceId,
      title: "Second",
    });
    store.appendTimeline(first.id, "run", {
      type: "run_start",
      userItemId: "user",
      prompt: "keep me",
    });

    store.setSessionPinned(first.id, true);
    expect(store.listSessions().map((session) => session.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(store.archiveSession(first.id).pinnedAt).toBeUndefined();
    expect(store.listSessions().map((session) => session.id)).toEqual([
      second.id,
    ]);
    expect(store.listSessions(true)).toHaveLength(2);
    expect(store.loadSnapshot(first.id).events).toHaveLength(1);
    store.restoreSession(first.id);
    expect(store.listSessions()).toHaveLength(2);
  });

  it("keeps sidebar order stable when session activity timestamps change", () => {
    const first = store.createSession({
      id: "first",
      workspaceRoot: directory,
      title: "First",
    });
    const second = store.createSession({
      id: "second",
      workspaceId: first.workspaceId,
      title: "Second",
    });

    expect(store.listSessions().map((session) => session.id)).toEqual([
      second.id,
      first.id,
    ]);

    store.setLifecycle(first.id, "idle");
    store.setRuntimeSessionId(first.id, "remote-session");

    expect(store.listSessions().map((session) => session.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("keeps workspace order stable when last_opened_at changes", () => {
    const alpha = store.createWorkspace({
      root: path.join(directory, "alpha"),
      name: "alpha",
    });
    const beta = store.createWorkspace({
      root: path.join(directory, "beta"),
      name: "beta",
    });

    expect(store.listWorkspaces().map((workspace) => workspace.id)).toEqual([
      alpha.id,
      beta.id,
    ]);

    store.touchWorkspace(beta.id);

    expect(store.listWorkspaces().map((workspace) => workspace.id)).toEqual([
      alpha.id,
      beta.id,
    ]);
  });

  it("migrates legacy workspace roots idempotently", () => {
    store.close();
    const filename = path.join(directory, "legacy.db");
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        workspace_root TEXT NOT NULL,
        title TEXT NOT NULL,
        lifecycle TEXT NOT NULL DEFAULT 'idle',
        approval_mode TEXT NOT NULL DEFAULT 'manual',
        runtime_kind TEXT NOT NULL DEFAULT 'native',
        runtime_version TEXT,
        runtime_session_id TEXT,
        active_run_id TEXT,
        last_seq INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO sessions VALUES
        ('legacy-1', '${directory.replaceAll("'", "''")}', 'One', 'idle',
         'manual', 'native', NULL, NULL, NULL, 0, 1, 1),
        ('legacy-2', '${directory.replaceAll("'", "''")}', 'Two', 'idle',
         'manual', 'native', NULL, NULL, NULL, 0, 2, 2);
    `);
    legacy.close();

    store = new SessionStore(filename);
    expect(store.listWorkspaces()).toHaveLength(1);
    expect(
      new Set(store.listSessions().map((session) => session.workspaceId)).size,
    ).toBe(1);
    store.close();
    store = new SessionStore(filename);
    expect(store.listWorkspaces()).toHaveLength(1);
  });

  it("folds legacy timeline deltas into committed session messages", () => {
    const filename = path.join(directory, "timeline-migration.db");
    store.close();
    store = new SessionStore(filename);
    store.createSession({
      id: "legacy-timeline",
      workspaceRoot: directory,
      runtimeKind: "dsh",
    });
    store.appendTimeline("legacy-timeline", "run", {
      type: "run_start",
      userItemId: "user",
      prompt: "hello",
    });
    store.appendTimeline("legacy-timeline", "run", {
      type: "assistant_start",
      turnId: "turn",
      itemId: "assistant",
    });
    store.appendTimeline("legacy-timeline", "run", {
      type: "assistant_text_delta",
      turnId: "turn",
      itemId: "assistant",
      delta: "migrated",
    });
    store.appendTimeline("legacy-timeline", "run", {
      type: "assistant_end",
      turnId: "turn",
      itemId: "assistant",
      stopReason: "stop",
      usage: { input: 0, output: 0, totalTokens: 0, cost: 0 },
    });
    store.close();
    store = new SessionStore(filename);

    expect(
      store
        .loadSessionEvents("legacy-timeline")
        .map((event) => event.event.kind),
    ).toEqual(["run.started", "message.assistant.committed"]);
    expect(
      JSON.stringify(store.loadSessionEvents("legacy-timeline")),
    ).toContain("migrated");
  });

  it("persists runtime identity and external session mapping", () => {
    const session = store.createSession({
      id: "dsh-session",
      workspaceRoot: directory,
      runtimeKind: "dsh",
      runtimeVersion: "0.1.3-alpha.1",
    });
    store.setRuntimeSessionId(session.id, "remote-dsh-session");
    expect(store.getSession(session.id)).toMatchObject({
      runtimeKind: "dsh",
      runtimeVersion: "0.1.3-alpha.1",
    });
    expect(store.getRuntimeSessionId(session.id)).toBe(
      "remote-dsh-session",
    );
  });

  it("does not reuse another runtime external id after switching runtime kind", () => {
    const session = store.createSession({
      id: "runtime-switch",
      workspaceRoot: directory,
      runtimeKind: "native",
    });
    store.setRuntimeSessionId(session.id, "native-remote");
    store.setRuntime(session.id, "codex", "0.154.0");
    expect(store.getRuntimeSessionId(session.id)).toBeUndefined();
    expect(
      store.getRuntimeSession(session.id, "native")?.externalSessionId,
    ).toBe("native-remote");
  });

  it("allocates monotonic timeline sequence values transactionally", () => {
    store.createSession({ id: "session-1", workspaceRoot: directory });
    const first = store.appendTimeline("session-1", "run-1", {
      type: "run_start",
      userItemId: "user-1",
      prompt: "hello",
    });
    const second = store.appendTimeline("session-1", "run-1", {
      type: "run_end",
      status: "completed",
    });
    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(store.loadSnapshot("session-1")).toMatchObject({
      lastSeq: 2,
      events: [{ seq: 1 }, { seq: 2 }],
    });
  });

  it("deduplicates messages by stable event key", () => {
    store.createSession({ id: "session-1", workspaceRoot: directory });
    const message: Message = {
      role: "user",
      content: "hello",
      timestamp: 1,
    };
    const first = store.appendMessage({
      sessionId: "session-1",
      eventKey: "user:run-1",
      runId: "run-1",
      message,
    });
    const duplicate = store.appendMessage({
      sessionId: "session-1",
      eventKey: "user:run-1",
      runId: "run-1",
      message,
    });
    expect(first).toEqual({ created: true, seq: 1 });
    expect(duplicate).toEqual({ created: false, seq: 1 });
    expect(store.loadMessages("session-1")).toEqual([message]);
  });

  it("round-trips checkpoint, approval and safe baseline data", () => {
    store.createSession({ id: "session-1", workspaceRoot: directory });
    const approval = {
      runId: "run-1",
      turnId: "run-1:turn:1",
      callId: "call-1",
      tool: "write_file",
      arguments: { path: "a.txt", content: "a" },
      effect: {
        kind: "filesystem-write" as const,
        operation: "write" as const,
        path: path.join(directory, "a.txt"),
        scope: "workspace" as const,
      },
      effectDigest: "digest",
      reason: "write",
    };
    store.setCheckpoint({
      sessionId: "session-1",
      runId: "run-1",
      phase: "awaiting_approval",
      turnId: approval.turnId,
      pendingCallId: approval.callId,
      pendingApproval: approval,
      updatedAt: 1,
    });
    store.savePendingApproval("session-1", approval);
    store.saveBaseline("session-1", {
      path: "a.txt",
      existed: true,
      content: Buffer.from("before"),
      size: 6,
      modifiedAt: 1,
      binary: false,
      sensitive: false,
      tooLarge: false,
    });
    store.setLifecycle("session-1", "awaiting_approval", "run-1");

    expect(store.getActiveCheckpoint("session-1")).toMatchObject({
      phase: "awaiting_approval",
      pendingCallId: "call-1",
    });
    expect(store.loadPendingApprovals("session-1")).toHaveLength(1);
    expect(store.loadBaselines("session-1")[0]?.content?.toString()).toBe(
      "before",
    );
    store.reconcile();
    expect(store.getSession("session-1")?.lifecycle).toBe(
      "awaiting_approval",
    );
  });

  it("migrates legacy lifecycle checks to allow awaiting_question", () => {
    store.close();
    const filename = path.join(directory, "legacy-lifecycle.db");
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        workspace_root TEXT NOT NULL,
        title TEXT NOT NULL,
        lifecycle TEXT NOT NULL DEFAULT 'idle'
          CHECK (lifecycle IN ('idle', 'running', 'awaiting_approval', 'crashed')),
        approval_mode TEXT NOT NULL DEFAULT 'manual',
        composer_mode TEXT NOT NULL DEFAULT 'agent',
        runtime_kind TEXT NOT NULL DEFAULT 'native',
        runtime_version TEXT,
        runtime_session_id TEXT,
        active_run_id TEXT,
        last_seq INTEGER NOT NULL DEFAULT 0,
        last_event_seq INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO sessions VALUES
        ('legacy-1', '${directory.replaceAll("'", "''")}', 'One', 'idle',
         'manual', 'agent', 'native', NULL, NULL, NULL, 0, 0, 1, 1);
    `);
    legacy.close();

    store = new SessionStore(filename);
    store.setLifecycle("legacy-1", "awaiting_question", "run-1");
    expect(store.getSession("legacy-1")?.lifecycle).toBe("awaiting_question");

    store.close();
    store = new SessionStore(filename);
    expect(store.getSession("legacy-1")?.lifecycle).toBe("awaiting_question");
  });

  it("persists awaiting_question checkpoints", () => {
    store.createSession({ id: "session-1", workspaceRoot: directory });
    const question = {
      runId: "run-1",
      turnId: "run-1:turn:1",
      callId: "call-1",
      questions: [{ id: "mode", question: "Which mode?" }],
    };
    store.setCheckpoint({
      sessionId: "session-1",
      runId: "run-1",
      phase: "awaiting_question",
      turnId: question.turnId,
      pendingCallId: question.callId,
      pendingQuestion: question,
      updatedAt: 1,
    });
    store.setLifecycle("session-1", "awaiting_question", "run-1");
    store.appendSessionEvent({
      sessionId: "session-1",
      runtimeKind: "native",
      runId: "run-1",
      turnId: question.turnId,
      toolCallId: question.callId,
      idempotencyKey: "question:call-1:requested",
      event: {
        kind: "question.requested",
        toolItemId: question.callId,
        question: {
          callId: question.callId,
          questions: question.questions,
        },
      },
    });

    expect(store.getActiveCheckpoint("session-1")).toMatchObject({
      phase: "awaiting_question",
      pendingQuestion: question,
    });
    expect(store.getSession("session-1")?.lifecycle).toBe("awaiting_question");
    store.reconcile();
    expect(store.getSession("session-1")?.lifecycle).toBe("awaiting_question");
  });

  it("marks an interrupted model stream as crashed exactly once", () => {
    store.createSession({ id: "session-1", workspaceRoot: directory });
    store.setLifecycle("session-1", "running", "run-1");
    store.setCheckpoint({
      sessionId: "session-1",
      runId: "run-1",
      phase: "streaming",
      turnId: "run-1:turn:1",
      updatedAt: 1,
    });

    store.reconcile();
    store.reconcile();

    expect(store.getSession("session-1")?.lifecycle).toBe("crashed");
    const ended = store
      .loadSessionEvents("session-1")
      .filter((entry) => entry.event.kind === "run.ended");
    expect(ended).toEqual([
      expect.objectContaining({
        event: { kind: "run.ended", status: "crashed" },
      }),
    ]);
  });

  it("does not retry a tool that started without a durable result", () => {
    store.createSession({ id: "session-1", workspaceRoot: directory });
    store.setLifecycle("session-1", "running", "run-1");
    store.setCheckpoint({
      sessionId: "session-1",
      runId: "run-1",
      phase: "executing_tool",
      turnId: "run-1:turn:1",
      pendingCallId: "call-1",
      updatedAt: 1,
    });
    store.reconcile();
    expect(
      store.getCheckpoint("session-1", "run-1")?.terminalStatus,
    ).toBe("crashed");
  });

  it("continues after a durable tool result even if checkpoint lagged", () => {
    store.createSession({ id: "session-1", workspaceRoot: directory });
    store.setLifecycle("session-1", "running", "run-1");
    store.setCheckpoint({
      sessionId: "session-1",
      runId: "run-1",
      phase: "executing_tool",
      turnId: "run-1:turn:1",
      pendingCallId: "call-1",
      updatedAt: 1,
    });
    store.appendSessionEvent({
      sessionId: "session-1",
      runtimeKind: "native",
      runId: "run-1",
      turnId: "run-1:turn:1",
      toolCallId: "call-1",
      idempotencyKey: "tool:call-1:result",
      event: {
        kind: "tool.result.committed",
        result: {
          toolCallId: "call-1",
          content: "done",
          isError: false,
        },
      },
    });
    store.reconcile();
    expect(store.getActiveCheckpoint("session-1")?.phase).toBe(
      "between_turns",
    );
  });

  it("tracks background task continuation claims", () => {
    const session = store.createSession({
      id: "session-1",
      workspaceRoot: directory,
    });
    const task = store.createBackgroundTask({
      id: "task-1",
      parentSessionId: session.id,
      parentRunId: "run-1",
      parentToolCallId: "tool-1",
      description: "Explore auth",
    });
    store.updateBackgroundTask(task.id, {
      status: "completed",
      summary: "done",
    });
    store.appendSessionEvent({
      sessionId: session.id,
      runtimeKind: "native",
      runId: "run-1",
      idempotencyKey: "task:task-1:notified",
      event: {
        kind: "task.notified",
        taskId: task.id,
        status: "completed",
        description: task.description,
        summary: "done",
      },
    });
    expect(store.hasTaskNotification(session.id, task.id)).toBe(true);
    const claimed = store.claimPendingContinuations(session.id);
    expect(claimed.map((entry) => entry.id)).toEqual([task.id]);
    store.releaseContinuations([task.id]);
    expect(store.claimPendingContinuations(session.id)).toHaveLength(1);
  });

  it("hides child sessions from listSessions", () => {
    const parent = store.createSession({
      id: "parent",
      workspaceRoot: directory,
    });
    store.createSession({
      id: "child",
      workspaceId: parent.workspaceId,
      parentSessionId: parent.id,
    });
    expect(store.listSessions().map((entry) => entry.id)).toEqual([parent.id]);
  });

  it("hides child sessions from listWorkspaces sidebar data", () => {
    const parent = store.createSession({
      id: "parent",
      workspaceRoot: directory,
    });
    store.createSession({
      id: "child",
      workspaceId: parent.workspaceId,
      parentSessionId: parent.id,
    });
    const workspace = store.listWorkspaces().find(
      (entry) => entry.id === parent.workspaceId,
    );
    expect(workspace?.sessions.map((entry) => entry.id)).toEqual([parent.id]);
  });
});
