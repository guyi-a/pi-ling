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
  RuntimeSessionImportOptions,
  RuntimeSessionOptions,
} from "@pi-ling/runtime-contracts";
import type {
  ApprovalMode,
  CanonicalMessage,
  TimelineEnvelope,
} from "@pi-ling/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DshAgentSession } from "./dsh-agent-session.js";
import { RunMessageBuffer } from "./run-message-buffer.js";
import * as sessionCompaction from "./session-compaction.js";
import { SessionStore } from "./session-store/session-store.js";

interface RecordedImport {
  mode: "import" | "append";
  sessionId: string;
  messageCount: number;
  appendToExternalSessionId?: string;
}

class FakeDshRuntime implements RuntimeAdapter {
  readonly kind = "dsh" as const;
  readonly capabilities = {} as RuntimeCapabilities;
  readonly listeners = new Set<RuntimeEventListener>();
  readonly imports: RecordedImport[] = [];
  readonly replacementByExternalId = new Map<string, string>();
  readonly failAppendForExternalId = new Set<string>();
  permission?: RuntimePermissionDecision;
  permissionEvent?: Omit<
    Extract<RuntimeEvent, { type: "permission" }>,
    "sessionId" | "runId"
  >;

  async initialize() {}
  async createSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    return { sessionId: options.sessionId, externalSessionId: "remote-1" };
  }
  resumeSession(options: RuntimeSessionOptions) {
    const replacement = options.externalSessionId
      ? this.replacementByExternalId.get(options.externalSessionId)
      : undefined;
    if (replacement) {
      return Promise.resolve({
        sessionId: options.sessionId,
        externalSessionId: replacement,
      });
    }
    return this.createSession(options);
  }
  async importSession(options: RuntimeSessionImportOptions) {
    if (
      options.appendToExternalSessionId &&
      this.failAppendForExternalId.has(options.appendToExternalSessionId)
    ) {
      throw new Error(
        `SessionPersistenceNotFoundError: session "${options.appendToExternalSessionId}" not found`,
      );
    }
    this.imports.push({
      mode: options.appendToExternalSessionId ? "append" : "import",
      sessionId: options.sessionId,
      messageCount: options.canonicalMessages.length,
      ...(options.appendToExternalSessionId
        ? { appendToExternalSessionId: options.appendToExternalSessionId }
        : {}),
    });
    return {
      externalSessionId:
        options.appendToExternalSessionId ?? options.sessionId,
    };
  }
  async send(sessionId: string, runId: string) {
    const executionGroupId = `${runId}:exec`;
    await this.emit({ type: "run_start", sessionId, runId });
    if (this.permissionEvent) {
      await this.emit({
        ...this.permissionEvent,
        sessionId,
        runId,
        executionGroupId,
      });
      return;
    }
    await this.emit({
      type: "assistant_thought",
      sessionId,
      runId,
      executionGroupId,
      delta: "think",
    });
    await this.emit({
      type: "tool",
      sessionId,
      runId,
      executionGroupId,
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
      executionGroupId,
      callId: "call-1",
      title: "Read file",
      status: "completed",
      output: "ok",
    });
    await this.emit({
      type: "assistant_text",
      sessionId,
      runId,
      executionGroupId,
      messageId: "msg-answer-1",
      delta: "done",
    });
    await this.emit({
      type: "context_usage",
      sessionId,
      runId,
      used: 8700,
      size: 1_000_000,
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
    vi.restoreAllMocks();
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  function seedUserRun(sessionId: string, runId: string, text: string): number {
    const userMessage: CanonicalMessage = {
      id: `${runId}:user`,
      role: "user",
      content: [{ type: "text", text }],
      sourceRuntime: "dsh",
      createdAt: Date.now(),
    };
    return store.appendSessionEvent({
      sessionId,
      runtimeKind: "dsh",
      runId,
      messageId: userMessage.id,
      idempotencyKey: `run:${runId}:start`,
      event: { kind: "run.started", userMessage },
    }).seq;
  }

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
      "tool_requested",
      "tool_start",
      "tool_end",
      "assistant_start",
      "assistant_thinking_delta",
      "assistant_end",
      "turn_start",
      "assistant_start",
      "assistant_text_delta",
      "assistant_end",
      "run_end",
    ]);
    const turnStarts = session
      .snapshot()
      .events.filter(({ event }) => event.type === "turn_start")
      .map(({ event }) => (event.type === "turn_start" ? event.turn : 0));
    expect(turnStarts).toEqual([1, 2]);
    expect(
      session
        .snapshot()
        .events.find(
          ({ event }) =>
            event.type === "assistant_end" &&
            event.stopReason === "stop",
        )?.event,
    ).toMatchObject({
      itemId: "msg-answer-1",
      contextUsage: { used: 8700, size: 1_000_000 },
    });
    expect(
      session
        .snapshot()
        .events.filter(
          ({ event }) => event.type === "tool_start",
        )
        .map(({ event }) =>
          event.type === "tool_start" ? event.turnId : "",
        ),
    ).toEqual(["run-1:assistant"]);
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

  it("emits changes after a write tool modifies a file", async () => {
    const target = path.join(directory, "b.md");
    await fs.writeFile(target, "hi", "utf8");
    const summary = store.createSession({
      workspaceRoot: directory,
      runtimeKind: "dsh",
      runtimeVersion: "0.1.3-alpha.1",
    });
    const runtime = new FakeDshRuntime();
    let sendDone: () => void = () => {};
    const sendFinished = new Promise<void>((resolve) => {
      sendDone = resolve;
    });
    runtime.send = async (sessionId, runId) => {
      await runtime.emit({ type: "run_start", sessionId, runId });
      await runtime.emit({
        type: "tool",
        sessionId,
        runId,
        executionGroupId: `${runId}:exec`,
        callId: "call-write",
        title: "write",
        kind: "edit",
        status: "running",
        input: { file_path: "b.md", content: "hiworld" },
      });
      await fs.writeFile(target, "hiworld", "utf8");
      await runtime.emit({
        type: "tool",
        sessionId,
        runId,
        executionGroupId: `${runId}:exec`,
        callId: "call-write",
        title: "write",
        kind: "edit",
        status: "completed",
        output: "ok",
      });
      await runtime.emit({
        type: "run_end",
        sessionId,
        runId,
        status: "completed",
      });
      sendDone();
    };
    const session = await DshAgentSession.open({
      store,
      session: summary,
      runtime,
      emit: () => {},
      buffer: new RunMessageBuffer(() => {}),
      availableRuntimes: ["native", "dsh"],
    });
    session.startPrompt("run-write", "append");
    await sendFinished;

    const eventTypes = session
      .snapshot()
      .events.map(({ event }) => event.type);
    expect(eventTypes).toContain("tool_end");
    expect(
      store.loadSessionEvents(summary.id).some(
        (entry) => entry.event.kind === "changes.committed",
      ),
    ).toBe(true);
    const changes = session
      .snapshot()
      .events.find(({ event }) => event.type === "changes")?.event;
    expect(changes).toMatchObject({
      type: "changes",
      files: [
        expect.objectContaining({
          path: "b.md",
          status: "modified",
          additions: expect.any(Number),
        }),
      ],
    });
    await session.dispose();
  });

  it("emits changes when DSH passes an absolute file path", async () => {
    const target = path.join(directory, "b.md");
    await fs.writeFile(target, "hiworld", "utf8");
    const summary = store.createSession({
      workspaceRoot: directory,
      runtimeKind: "dsh",
      runtimeVersion: "0.1.3-alpha.1",
    });
    const runtime = new FakeDshRuntime();
    let sendDone: () => void = () => {};
    const sendFinished = new Promise<void>((resolve) => {
      sendDone = resolve;
    });
    runtime.send = async (sessionId, runId) => {
      await runtime.emit({ type: "run_start", sessionId, runId });
      await runtime.emit({
        type: "tool",
        sessionId,
        runId,
        executionGroupId: `${runId}:exec`,
        callId: "call-write-abs",
        title: "write",
        kind: "edit",
        status: "running",
        input: { file_path: target, content: "hi" },
      });
      await fs.writeFile(target, "hi", "utf8");
      await runtime.emit({
        type: "tool",
        sessionId,
        runId,
        executionGroupId: `${runId}:exec`,
        callId: "call-write-abs",
        title: "write",
        kind: "edit",
        status: "completed",
        output: "ok",
      });
      await runtime.emit({
        type: "run_end",
        sessionId,
        runId,
        status: "completed",
      });
      sendDone();
    };
    const session = await DshAgentSession.open({
      store,
      session: summary,
      runtime,
      emit: () => {},
      buffer: new RunMessageBuffer(() => {}),
      availableRuntimes: ["native", "dsh"],
    });
    session.startPrompt("run-abs", "rewrite");
    await sendFinished;

    const changes = session
      .snapshot()
      .events.find(({ event }) => event.type === "changes")?.event;
    expect(changes).toMatchObject({
      type: "changes",
      files: [expect.objectContaining({ path: "b.md" })],
    });
    await session.dispose();
  });

  it("matches Native approval behavior for DSH permissions", async () => {
    const cases: Array<{
      name: string;
      mode: ApprovalMode;
      toolKind?: string;
      title: string;
      input: Record<string, unknown>;
      asks: boolean;
    }> = [
      {
        name: "unknown-auto",
        mode: "auto",
        title: "new-tool",
        input: {},
        asks: true,
      },
      {
        name: "sensitive-auto",
        mode: "auto",
        toolKind: "edit",
        title: "write",
        input: { file_path: ".env", content: "API_KEY=secret" },
        asks: true,
      },
      {
        name: "write-accept",
        mode: "accept-write",
        toolKind: "edit",
        title: "write",
        input: { file_path: "file.txt", content: "hello" },
        asks: false,
      },
      {
        name: "harmless-manual",
        mode: "manual",
        toolKind: "execute",
        title: "bash",
        input: { command: "git status" },
        asks: false,
      },
      {
        name: "normal-accept",
        mode: "accept-write",
        toolKind: "execute",
        title: "bash",
        input: { command: "pnpm test" },
        asks: true,
      },
      {
        name: "destructive-auto",
        mode: "auto",
        toolKind: "execute",
        title: "bash",
        input: { command: "git reset --hard" },
        asks: true,
      },
    ];

    for (const testCase of cases) {
      const created = store.createSession({
        workspaceRoot: directory,
        runtimeKind: "dsh",
        title: testCase.name,
      });
      const summary = store.setApprovalMode(created.id, testCase.mode);
      const runtime = new FakeDshRuntime();
      runtime.permissionEvent = {
        type: "permission",
        executionGroupId: "permission:exec",
        permissionId: `permission:${testCase.name}`,
        callId: `call:${testCase.name}`,
        title: testCase.title,
        ...(testCase.toolKind ? { toolKind: testCase.toolKind } : {}),
        input: testCase.input,
        options: [
          {
            optionId: "allow",
            label: "Allow",
            kind: "allow_once",
          },
          {
            optionId: "reject",
            label: "Reject",
            kind: "reject_once",
          },
        ],
      };
      const session = await DshAgentSession.open({
        store,
        session: summary,
        runtime,
        emit: () => {},
        buffer: new RunMessageBuffer(() => {}),
        availableRuntimes: ["native", "dsh"],
      });
      session.startPrompt(`run:${testCase.name}`, "test");
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        session
          .snapshot()
          .events.some(({ event }) => event.type === "approval_requested"),
        testCase.name,
      ).toBe(testCase.asks);
      expect(runtime.permission !== undefined, testCase.name).toBe(
        !testCase.asks,
      );
      expect(
        store.getSession(summary.id)?.lifecycle,
        testCase.name,
      ).toBe(testCase.asks ? "awaiting_approval" : "running");
      await session.dispose();
    }
  });

  it("re-imports full history on open when compaction crossed the watermark", async () => {
    const summary = store.createSession({
      workspaceRoot: directory,
      runtimeKind: "dsh",
      runtimeVersion: "0.1.3-alpha.1",
    });
    const firstSeq = seedUserRun(summary.id, "run-old", "hello");
    store.appendSessionEvent({
      sessionId: summary.id,
      runtimeKind: "dsh",
      runId: "run-old",
      turnId: "run-old:assistant",
      messageId: "run-old:assistant",
      idempotencyKey: "assistant:run-old:assistant",
      event: {
        kind: "message.assistant.committed",
        message: {
          id: "run-old:assistant",
          role: "assistant",
          content: [{ type: "text", text: "world" }],
          sourceRuntime: "dsh",
          createdAt: Date.now(),
        },
        stopReason: "stop",
        usage: { input: 0, output: 0, totalTokens: 0, cost: 0 },
      },
    });
    store.setRuntimeImport(summary.id, "remote-old", firstSeq + 1);
    const summaryMessage: CanonicalMessage = {
      id: "compaction:comp-1",
      role: "user",
      content: [
        {
          type: "text",
          text: '<compacted-summary id="comp-1">folded</compacted-summary>',
        },
      ],
      sourceRuntime: "dsh",
      createdAt: Date.now(),
      rawPayload: { internal: true, compaction: true, compactionId: "comp-1" },
    };
    store.appendSessionEvent({
      sessionId: summary.id,
      // Compaction from another runtime must not advance the DSH watermark.
      runtimeKind: "native",
      runId: "session",
      messageId: summaryMessage.id,
      idempotencyKey: "compaction:comp-1",
      event: {
        kind: "compaction.applied",
        compactionId: "comp-1",
        throughMessageId: "run-old:assistant",
        summary: summaryMessage,
        replacedMessageIds: ["run-old:user", "run-old:assistant"],
        replacedCount: 2,
      },
    });

    const runtime = new FakeDshRuntime();
    await DshAgentSession.open({
      store,
      session: summary,
      runtime,
      emit: () => {},
      buffer: new RunMessageBuffer(() => {}),
      availableRuntimes: ["native", "dsh"],
    });

    expect(runtime.imports).toHaveLength(1);
    expect(runtime.imports[0]).toMatchObject({
      mode: "import",
      messageCount: 1,
    });
    expect(runtime.imports[0]?.appendToExternalSessionId).toBeUndefined();
    expect(store.getRuntimeSessionId(summary.id)).not.toBe("remote-old");
  });

  it("reimports full history when delta append targets a missing DSH session", async () => {
    const summary = store.createSession({
      workspaceRoot: directory,
      runtimeKind: "dsh",
      runtimeVersion: "0.1.3-alpha.1",
    });
    const firstSeq = seedUserRun(summary.id, "run-a", "hello");
    store.setRuntimeImport(summary.id, "missing-remote", firstSeq);
    seedUserRun(summary.id, "run-b", "follow up");

    const runtime = new FakeDshRuntime();
    runtime.failAppendForExternalId.add("missing-remote");
    await DshAgentSession.open({
      store,
      session: summary,
      runtime,
      emit: () => {},
      buffer: new RunMessageBuffer(() => {}),
      availableRuntimes: ["native", "dsh"],
    });

    expect(runtime.imports.length).toBeGreaterThanOrEqual(1);
    expect(runtime.imports.some((entry) => entry.mode === "import")).toBe(true);
    expect(store.getRuntimeSessionId(summary.id)).not.toBe("missing-remote");
  });

  it("appends history when a stale DSH session is replaced during resume", async () => {
    const summary = store.createSession({
      workspaceRoot: directory,
      runtimeKind: "dsh",
      runtimeVersion: "0.1.3-alpha.1",
    });
    seedUserRun(summary.id, "run-a", "hello");
    store.setRuntimeImport(summary.id, "stale-remote", 1);

    const runtime = new FakeDshRuntime();
    runtime.replacementByExternalId.set("stale-remote", "recovered-remote");
    await DshAgentSession.open({
      store,
      session: summary,
      runtime,
      emit: () => {},
      buffer: new RunMessageBuffer(() => {}),
      availableRuntimes: ["native", "dsh"],
    });

    expect(runtime.imports).toHaveLength(1);
    expect(runtime.imports[0]).toMatchObject({
      mode: "import",
      messageCount: 1,
    });
    expect(runtime.imports[0]?.appendToExternalSessionId).toBeUndefined();
    expect(store.getRuntimeSessionId(summary.id)).not.toBe("stale-remote");
  });

  it("re-imports compacted history before startPrompt sends", async () => {
    const summary = store.createSession({
      workspaceRoot: directory,
      runtimeKind: "dsh",
      runtimeVersion: "0.1.3-alpha.1",
    });
    seedUserRun(summary.id, "run-seed", "prior");
    store.setRuntimeImport(summary.id, "remote-seed", 1);

    const summaryMessage: CanonicalMessage = {
      id: "compaction:comp-2",
      role: "user",
      content: [
        {
          type: "text",
          text: "<compacted-summary>folded</compacted-summary>",
        },
      ],
      sourceRuntime: "dsh",
      createdAt: Date.now(),
      rawPayload: { internal: true, compaction: true, compactionId: "comp-2" },
    };
    const compacted = store.appendSessionEvent({
      sessionId: summary.id,
      runtimeKind: "native",
      runId: "session",
      messageId: summaryMessage.id,
      idempotencyKey: "compaction:comp-2",
      event: {
        kind: "compaction.applied",
        compactionId: "comp-2",
        throughMessageId: "run-seed:user",
        summary: summaryMessage,
        replacedMessageIds: ["run-seed:user"],
        replacedCount: 1,
      },
    });

    vi.spyOn(sessionCompaction, "maybeCompactSessionBeforeRun").mockResolvedValueOnce(
      compacted,
    );

    const runtime = new FakeDshRuntime();
    runtime.send = async () => {};
    const session = await DshAgentSession.open({
      store,
      session: summary,
      runtime,
      emit: () => {},
      buffer: new RunMessageBuffer(() => {}),
      availableRuntimes: ["native", "dsh"],
    });
    session.startPrompt("run-next", "continue");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const freshImports = runtime.imports.filter((entry) => entry.mode === "import");
    expect(freshImports.length).toBeGreaterThan(0);
    expect(freshImports.at(-1)).toMatchObject({
      mode: "import",
      messageCount: 1,
    });
    await session.dispose();
  });
});
