import { randomUUID } from "node:crypto";

import type {
  AgentStatus,
  CreateSessionRequest,
  SessionActivation,
  SessionSummary,
  TimelineEnvelope,
  TimelineSnapshot,
} from "@pi-ling/contracts";

import { PiAgentSession } from "./pi-agent-session.js";
import { SessionStore } from "./session-store/session-store.js";

export class SessionSupervisor {
  readonly #store: SessionStore;
  readonly #emit: (envelope: TimelineEnvelope) => void;
  readonly #emptySessionId = randomUUID();
  #active: PiAgentSession | undefined;
  #generation = 0;

  constructor(
    store: SessionStore,
    emit: (envelope: TimelineEnvelope) => void,
  ) {
    this.#store = store;
    this.#emit = emit;
  }

  async initialize(): Promise<void> {
    const latest = this.#store.listSessions()[0];
    if (latest) {
      await this.activate(latest.id);
    }
  }

  list(): SessionSummary[] {
    return this.#store.listSessions();
  }

  async create(request: CreateSessionRequest): Promise<SessionActivation> {
    const session = this.#store.createSession({
      workspaceRoot: request.workspaceRoot,
      ...(request.title ? { title: request.title } : {}),
    });
    return this.activate(session.id);
  }

  async activate(sessionId: string): Promise<SessionActivation> {
    const session = this.#store.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (this.#active) {
      await this.#active.dispose();
    }
    const generation = ++this.#generation;
    const active = await PiAgentSession.open({
      store: this.#store,
      session,
      emit: (envelope) => {
        if (generation === this.#generation) {
          this.#emit(envelope);
        }
      },
    });
    this.#active = active;
    return {
      session: this.#store.getSession(sessionId)!,
      status: this.#active.status,
      snapshot: this.#active.snapshot(),
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
        provider: "deepseek",
        model: "deepseek-v4-flash",
        configured: Boolean(process.env["DEEPSEEK_API_KEY"]?.trim()),
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
    if (!this.#active) {
      throw new Error("Create or select a session first");
    }
    this.#active.startPrompt(runId, prompt);
  }

  cancel(runId: string): boolean {
    return this.#active?.cancel(runId) ?? false;
  }

  resolveApproval(
    callId: string,
    decision: Parameters<PiAgentSession["resolveApproval"]>[1],
  ): Promise<boolean> {
    return this.#active?.resolveApproval(callId, decision) ??
      Promise.resolve(false);
  }

  changedFiles() {
    return this.#active?.changedFiles() ?? Promise.resolve([]);
  }

  diff(path: string) {
    return this.#active?.diff(path) ?? Promise.resolve(undefined);
  }

  async dispose(): Promise<void> {
    this.#generation += 1;
    if (this.#active) {
      await this.#active.dispose();
    }
    this.#active = undefined;
  }
}
