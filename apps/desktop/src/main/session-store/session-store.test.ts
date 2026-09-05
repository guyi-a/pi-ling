import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Message } from "@pi-ling/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionStore } from "./session-store.js";

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

  it("creates, lists and deletes sessions", () => {
    const session = store.createSession({
      id: "session-1",
      workspaceRoot: directory,
      title: "Test",
    });
    expect(session.title).toBe("Test");
    expect(store.listSessions()).toHaveLength(1);
    store.deleteSession(session.id);
    expect(store.listSessions()).toHaveLength(0);
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
    expect(store.loadSnapshot("session-1").events).toEqual([
      expect.objectContaining({
        event: { type: "run_end", status: "crashed" },
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
    store.appendTimeline("session-1", "run-1", {
      type: "tool_end",
      turnId: "run-1:turn:1",
      itemId: "call-1",
      callId: "call-1",
      tool: "write_file",
      isError: false,
      output: "done",
    });
    store.reconcile();
    expect(store.getActiveCheckpoint("session-1")?.phase).toBe(
      "between_turns",
    );
  });
});
