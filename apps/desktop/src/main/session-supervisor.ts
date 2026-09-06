import { randomUUID } from "node:crypto";

import type { RuntimeAdapter } from "@pi-ling/runtime-contracts";
import type {
  AgentStatus,
  ApprovalMode,
  CreateSessionRequest,
  ChangedFile,
  FileDiff,
  RuntimeKind,
  SessionActivation,
  SessionSummary,
  TimelineEnvelope,
  TimelineSnapshot,
} from "@pi-ling/contracts";

import { DshAgentSession } from "./dsh-agent-session.js";
import { PiAgentSession } from "./pi-agent-session.js";
import { SessionStore } from "./session-store/session-store.js";

type ApprovalDecision = {
  approved: boolean;
  effectDigest: string;
  reason?: string;
};

interface ActiveSession {
  readonly sessionId: string;
  readonly status: AgentStatus;
  snapshot(): TimelineSnapshot;
  startPrompt(runId: string, prompt: string): void;
  cancel(runId: string): boolean | Promise<boolean>;
  resolveApproval(
    callId: string,
    decision: ApprovalDecision,
  ): Promise<boolean>;
  changedFiles(): Promise<ChangedFile[]>;
  diff(path: string): Promise<FileDiff | undefined>;
  setApprovalMode(mode: ApprovalMode): SessionSummary;
  dispose(): Promise<void>;
}

export class SessionSupervisor {
  readonly #store: SessionStore;
  readonly #emit: (envelope: TimelineEnvelope) => void;
  readonly #dshRuntime: RuntimeAdapter | undefined;
  readonly #emptySessionId = randomUUID();
  #active: ActiveSession | undefined;
  #generation = 0;

  constructor(
    store: SessionStore,
    emit: (envelope: TimelineEnvelope) => void,
    dshRuntime?: RuntimeAdapter,
  ) {
    this.#store = store;
    this.#emit = emit;
    this.#dshRuntime = dshRuntime;
  }

  get availableRuntimes(): RuntimeKind[] {
    return this.#dshRuntime ? ["native", "dsh"] : ["native"];
  }

  async initialize(): Promise<void> {
    for (const session of this.#store.listSessions()) {
      try {
        await this.activate(session.id);
        return;
      } catch {
        this.#store.setLifecycle(session.id, "crashed");
      }
    }
  }

  list(): SessionSummary[] {
    return this.#store.listSessions();
  }

  async create(request: CreateSessionRequest): Promise<SessionActivation> {
    const runtimeKind = request.runtimeKind ?? "native";
    if (runtimeKind === "dsh" && !this.#dshRuntime) {
      throw new Error("DSH Runtime is not enabled");
    }
    const session = this.#store.createSession({
      workspaceRoot: request.workspaceRoot,
      ...(request.title ? { title: request.title } : {}),
      runtimeKind,
      runtimeVersion:
        runtimeKind === "dsh" ? "0.1.3-alpha.1" : "0.1.0",
    });
    try {
      return await this.activate(session.id);
    } catch (error) {
      this.#store.deleteSession(session.id);
      throw error;
    }
  }

  async activate(sessionId: string): Promise<SessionActivation> {
    const session = this.#store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (this.#active) await this.#active.dispose();
    const generation = ++this.#generation;
    const emit = (envelope: TimelineEnvelope) => {
      if (generation === this.#generation) this.#emit(envelope);
    };
    const active: ActiveSession =
      session.runtimeKind === "dsh"
        ? await this.#openDsh(session, emit)
        : await PiAgentSession.open({
            store: this.#store,
            session,
            emit,
            availableRuntimes: this.availableRuntimes,
          });
    this.#active = active;
    return {
      session: this.#store.getSession(sessionId)!,
      status: active.status,
      snapshot: active.snapshot(),
    };
  }

  async delete(sessionId: string): Promise<void> {
    if (this.#active?.sessionId === sessionId) {
      this.#generation += 1;
      await this.#active.dispose();
      this.#active = undefined;
    }
    this.#store.deleteSession(sessionId);
  }

  get status(): AgentStatus {
    return (
      this.#active?.status ?? {
        runtimeKind: "native",
        availableRuntimes: this.availableRuntimes,
        provider: "deepseek",
        model: "deepseek-v4-flash",
        configured: Boolean(process.env["DEEPSEEK_API_KEY"]?.trim()),
        approvalMode: "manual",
      }
    );
  }

  snapshot(): TimelineSnapshot {
    return (
      this.#active?.snapshot() ?? {
        sessionId: this.#emptySessionId,
        lastSeq: 0,
        events: [],
      }
    );
  }

  startPrompt(runId: string, prompt: string): void {
    if (!this.#active) throw new Error("Create or select a session first");
    this.#active.startPrompt(runId, prompt);
  }

  cancel(runId: string): boolean | Promise<boolean> {
    return this.#active?.cancel(runId) ?? false;
  }

  resolveApproval(
    callId: string,
    decision: ApprovalDecision,
  ): Promise<boolean> {
    return (
      this.#active?.resolveApproval(callId, decision) ??
      Promise.resolve(false)
    );
  }

  changedFiles() {
    return this.#active?.changedFiles() ?? Promise.resolve([]);
  }

  diff(path: string) {
    return this.#active?.diff(path) ?? Promise.resolve(undefined);
  }

  setApprovalMode(mode: ApprovalMode): SessionSummary {
    if (!this.#active) throw new Error("No active session");
    return this.#active.setApprovalMode(mode);
  }

  async switchRuntime(runtimeKind: RuntimeKind): Promise<SessionActivation> {
    if (!this.#active) throw new Error("No active session");
    if (runtimeKind === "dsh" && !this.#dshRuntime) {
      throw new Error("DSH Runtime is not enabled");
    }
    if (this.#active.status.runtimeKind === runtimeKind) {
      return {
        session: this.#store.getSession(this.#active.sessionId)!,
        status: this.#active.status,
        snapshot: this.#active.snapshot(),
      };
    }
    const sessionId = this.#active.sessionId;
    const previousRuntime = this.#active.status.runtimeKind;
    this.#generation += 1;
    await this.#active.dispose();
    this.#active = undefined;
    this.#store.setRuntime(
      sessionId,
      runtimeKind,
      runtimeKind === "dsh" ? "0.1.3-alpha.1" : "0.1.0",
    );
    try {
      return await this.activate(sessionId);
    } catch (error) {
      this.#store.setRuntime(
        sessionId,
        previousRuntime,
        previousRuntime === "dsh" ? "0.1.3-alpha.1" : "0.1.0",
      );
      await this.activate(sessionId);
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.#generation += 1;
    if (this.#active) await this.#active.dispose();
    this.#active = undefined;
  }

  async #openDsh(
    session: SessionSummary,
    emit: (envelope: TimelineEnvelope) => void,
  ): Promise<DshAgentSession> {
    if (!this.#dshRuntime) throw new Error("DSH Runtime is not enabled");
    return DshAgentSession.open({
      store: this.#store,
      session,
      runtime: this.#dshRuntime,
      emit,
      availableRuntimes: this.availableRuntimes,
    });
  }
}
