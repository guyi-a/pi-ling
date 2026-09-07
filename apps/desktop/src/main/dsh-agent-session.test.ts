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
import type {
  ApprovalMode,
  TimelineEnvelope,
} from "@pi-ling/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DshAgentSession } from "./dsh-agent-session.js";
import { RunMessageBuffer } from "./run-message-buffer.js";
import { SessionStore } from "./session-store/session-store.js";

class FakeDshRuntime implements RuntimeAdapter {
  readonly kind = "dsh" as const;
  readonly capabilities = {} as RuntimeCapabilities;
  readonly listeners = new Set<RuntimeEventListener>();
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
    return this.createSession(options);
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
});
