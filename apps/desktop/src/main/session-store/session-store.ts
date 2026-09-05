import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Message, ToolCall } from "@pi-ling/ai";
import type { ApprovalRequest as RuntimeApprovalRequest } from "@pi-ling/coding-agent";
import type {
  ApprovalMode,
  SessionLifecycle,
  SessionSummary,
  TimelineEnvelope,
  TimelineEvent,
  TimelineSnapshot,
} from "@pi-ling/contracts";

import { SESSION_SCHEMA } from "./schema.js";

export type CheckpointPhase =
  | "started"
  | "streaming"
  | "awaiting_approval"
  | "approved_pending_exec"
  | "executing_tool"
  | "between_turns"
  | "terminal";

export interface RunCheckpoint {
  sessionId: string;
  runId: string;
  phase: CheckpointPhase;
  terminalStatus?: "completed" | "cancelled" | "error" | "crashed";
  turnId?: string;
  pendingCallId?: string;
  pendingTool?: ToolCall;
  pendingApproval?: RuntimeApprovalRequest;
  updatedAt: number;
}

export interface StoredBaseline {
  path: string;
  existed: boolean;
  content?: Buffer;
  size: number;
  modifiedAt: number;
  binary: boolean;
  sensitive: boolean;
  tooLarge: boolean;
}

interface SessionRow {
  session_id: string;
  workspace_root: string;
  title: string;
  lifecycle: SessionLifecycle;
  approval_mode: ApprovalMode;
  active_run_id: string | null;
  last_seq: number;
  created_at: number;
  updated_at: number;
}

function sessionFromRow(row: SessionRow): SessionSummary {
  return {
    id: row.session_id,
    title: row.title,
    workspace: {
      root: row.workspace_root,
      name: path.basename(row.workspace_root),
    },
    lifecycle: row.lifecycle,
    approvalMode: row.approval_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SessionStore {
  readonly #db: DatabaseSync;

  constructor(filename: string) {
    this.#db = new DatabaseSync(filename);
    this.#db.exec(SESSION_SCHEMA);
    const columns = this.#db
      .prepare("PRAGMA table_info(sessions)")
      .all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "approval_mode")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'manual'",
      );
    }
  }

  close(): void {
    this.#db.close();
  }

  createSession(input: {
    id?: string;
    workspaceRoot: string;
    title?: string;
  }): SessionSummary {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const title = input.title?.trim() || path.basename(input.workspaceRoot);
    this.#db
      .prepare(
        `INSERT INTO sessions
          (session_id, workspace_root, title, lifecycle, created_at, updated_at)
         VALUES (?, ?, ?, 'idle', ?, ?)`,
      )
      .run(id, path.resolve(input.workspaceRoot), title, now, now);
    return this.getSession(id)!;
  }

  getSession(sessionId: string): SessionSummary | undefined {
    const row = this.#db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as SessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  listSessions(): SessionSummary[] {
    const rows = this.#db
      .prepare(
        "SELECT * FROM sessions ORDER BY updated_at DESC, rowid DESC",
      )
      .all() as unknown as SessionRow[];
    return rows.map(sessionFromRow);
  }

  deleteSession(sessionId: string): void {
    this.#db
      .prepare("DELETE FROM sessions WHERE session_id = ?")
      .run(sessionId);
  }

  appendTimeline(
    sessionId: string,
    runId: string,
    event: TimelineEvent,
    emittedAt = Date.now(),
  ): TimelineEnvelope {
    return this.#transaction(() => {
      const row = this.#db
        .prepare("SELECT last_seq FROM sessions WHERE session_id = ?")
        .get(sessionId) as { last_seq: number } | undefined;
      if (!row) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const seq = row.last_seq + 1;
      this.#db
        .prepare(
          `INSERT INTO timeline_events
            (session_id, seq, run_id, emitted_at, event_json)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(sessionId, seq, runId, emittedAt, JSON.stringify(event));
      this.#db
        .prepare(
          `UPDATE sessions
           SET last_seq = ?, updated_at = ?
           WHERE session_id = ?`,
        )
        .run(seq, emittedAt, sessionId);
      return { sessionId, runId, seq, emittedAt, event };
    });
  }

  loadSnapshot(sessionId: string): TimelineSnapshot {
    const session = this.#db
      .prepare("SELECT last_seq FROM sessions WHERE session_id = ?")
      .get(sessionId) as { last_seq: number } | undefined;
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const rows = this.#db
      .prepare(
        `SELECT seq, run_id, emitted_at, event_json
         FROM timeline_events
         WHERE session_id = ?
         ORDER BY seq`,
      )
      .all(sessionId) as unknown as Array<{
      seq: number;
      run_id: string;
      emitted_at: number;
      event_json: string;
    }>;
    return {
      sessionId,
      lastSeq: session.last_seq,
      events: rows.map((row) => ({
        sessionId,
        runId: row.run_id,
        seq: row.seq,
        emittedAt: row.emitted_at,
        event: JSON.parse(row.event_json) as TimelineEvent,
      })),
    };
  }

  appendMessage(input: {
    sessionId: string;
    eventKey: string;
    runId: string;
    turnId?: string;
    message: Message;
  }): { created: boolean; seq: number } {
    return this.#transaction(() => {
      const existing = this.#db
        .prepare(
          `SELECT msg_seq FROM agent_messages
           WHERE session_id = ? AND event_key = ?`,
        )
        .get(input.sessionId, input.eventKey) as
        | { msg_seq: number }
        | undefined;
      if (existing) {
        return { created: false, seq: existing.msg_seq };
      }
      const row = this.#db
        .prepare(
          `SELECT COALESCE(MAX(msg_seq), 0) AS max_seq
           FROM agent_messages WHERE session_id = ?`,
        )
        .get(input.sessionId) as { max_seq: number };
      const seq = row.max_seq + 1;
      this.#db
        .prepare(
          `INSERT INTO agent_messages
            (session_id, msg_seq, event_key, run_id, turn_id, role,
             message_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.sessionId,
          seq,
          input.eventKey,
          input.runId,
          input.turnId ?? null,
          input.message.role,
          JSON.stringify(input.message),
          Date.now(),
        );
      return { created: true, seq };
    });
  }

  loadMessages(sessionId: string): Message[] {
    const rows = this.#db
      .prepare(
        `SELECT message_json FROM agent_messages
         WHERE session_id = ? ORDER BY msg_seq`,
      )
      .all(sessionId) as unknown as Array<{ message_json: string }>;
    return rows.map((row) => JSON.parse(row.message_json) as Message);
  }

  setLifecycle(
    sessionId: string,
    lifecycle: SessionLifecycle,
    activeRunId?: string,
  ): void {
    this.#db
      .prepare(
        `UPDATE sessions
         SET lifecycle = ?, active_run_id = ?, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(lifecycle, activeRunId ?? null, Date.now(), sessionId);
  }

  setApprovalMode(
    sessionId: string,
    mode: ApprovalMode,
  ): SessionSummary {
    this.#db
      .prepare(
        `UPDATE sessions SET approval_mode = ?, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(mode, Date.now(), sessionId);
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  setCheckpoint(checkpoint: RunCheckpoint): void {
    this.#db
      .prepare(
        `INSERT INTO run_checkpoints
          (session_id, run_id, phase, terminal_status, turn_id,
           pending_call_id, pending_tool_json, pending_approval_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, run_id) DO UPDATE SET
           phase = excluded.phase,
           terminal_status = excluded.terminal_status,
           turn_id = excluded.turn_id,
           pending_call_id = excluded.pending_call_id,
           pending_tool_json = excluded.pending_tool_json,
           pending_approval_json = excluded.pending_approval_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        checkpoint.sessionId,
        checkpoint.runId,
        checkpoint.phase,
        checkpoint.terminalStatus ?? null,
        checkpoint.turnId ?? null,
        checkpoint.pendingCallId ?? null,
        checkpoint.pendingTool
          ? JSON.stringify(checkpoint.pendingTool)
          : null,
        checkpoint.pendingApproval
          ? JSON.stringify(checkpoint.pendingApproval)
          : null,
        checkpoint.updatedAt,
      );
  }

  getCheckpoint(
    sessionId: string,
    runId: string,
  ): RunCheckpoint | undefined {
    const row = this.#db
      .prepare(
        `SELECT * FROM run_checkpoints
         WHERE session_id = ? AND run_id = ?`,
      )
      .get(sessionId, runId) as
      | {
          session_id: string;
          run_id: string;
          phase: CheckpointPhase;
          terminal_status: RunCheckpoint["terminalStatus"] | null;
          turn_id: string | null;
          pending_call_id: string | null;
          pending_tool_json: string | null;
          pending_approval_json: string | null;
          updated_at: number;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      sessionId: row.session_id,
      runId: row.run_id,
      phase: row.phase,
      updatedAt: row.updated_at,
      ...(row.terminal_status
        ? { terminalStatus: row.terminal_status }
        : {}),
      ...(row.turn_id ? { turnId: row.turn_id } : {}),
      ...(row.pending_call_id
        ? { pendingCallId: row.pending_call_id }
        : {}),
      ...(row.pending_tool_json
        ? { pendingTool: JSON.parse(row.pending_tool_json) as ToolCall }
        : {}),
      ...(row.pending_approval_json
        ? {
            pendingApproval: JSON.parse(
              row.pending_approval_json,
            ) as RuntimeApprovalRequest,
          }
        : {}),
    };
  }

  getActiveCheckpoint(sessionId: string): RunCheckpoint | undefined {
    const row = this.#db
      .prepare(
        `SELECT active_run_id FROM sessions WHERE session_id = ?`,
      )
      .get(sessionId) as { active_run_id: string | null } | undefined;
    return row?.active_run_id
      ? this.getCheckpoint(sessionId, row.active_run_id)
      : undefined;
  }

  savePendingApproval(
    sessionId: string,
    approval: RuntimeApprovalRequest,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO pending_approvals
          (session_id, call_id, run_id, turn_id, approval_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, call_id) DO UPDATE SET
           approval_json = excluded.approval_json`,
      )
      .run(
        sessionId,
        approval.callId,
        approval.runId,
        approval.turnId,
        JSON.stringify(approval),
        Date.now(),
      );
  }

  loadPendingApprovals(
    sessionId: string,
  ): RuntimeApprovalRequest[] {
    const rows = this.#db
      .prepare(
        `SELECT approval_json FROM pending_approvals
         WHERE session_id = ? ORDER BY created_at`,
      )
      .all(sessionId) as unknown as Array<{ approval_json: string }>;
    return rows.map(
      (row) => JSON.parse(row.approval_json) as RuntimeApprovalRequest,
    );
  }

  deletePendingApproval(sessionId: string, callId: string): void {
    this.#db
      .prepare(
        `DELETE FROM pending_approvals
         WHERE session_id = ? AND call_id = ?`,
      )
      .run(sessionId, callId);
  }

  saveBaseline(sessionId: string, baseline: StoredBaseline): void {
    this.#db
      .prepare(
        `INSERT INTO file_baselines
          (session_id, path, existed, content, size, modified_at,
           binary, sensitive, too_large)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, path) DO UPDATE SET
           existed = excluded.existed,
           content = excluded.content,
           size = excluded.size,
           modified_at = excluded.modified_at,
           binary = excluded.binary,
           sensitive = excluded.sensitive,
           too_large = excluded.too_large`,
      )
      .run(
        sessionId,
        baseline.path,
        baseline.existed ? 1 : 0,
        baseline.content ?? null,
        baseline.size,
        baseline.modifiedAt,
        baseline.binary ? 1 : 0,
        baseline.sensitive ? 1 : 0,
        baseline.tooLarge ? 1 : 0,
      );
  }

  loadBaselines(sessionId: string): StoredBaseline[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM file_baselines WHERE session_id = ? ORDER BY path`,
      )
      .all(sessionId) as unknown as Array<{
      path: string;
      existed: number;
      content: Uint8Array | null;
      size: number;
      modified_at: number;
      binary: number;
      sensitive: number;
      too_large: number;
    }>;
    return rows.map((row) => ({
      path: row.path,
      existed: row.existed === 1,
      ...(row.content ? { content: Buffer.from(row.content) } : {}),
      size: row.size,
      modifiedAt: row.modified_at,
      binary: row.binary === 1,
      sensitive: row.sensitive === 1,
      tooLarge: row.too_large === 1,
    }));
  }

  clearBaselines(sessionId: string): void {
    this.#db
      .prepare("DELETE FROM file_baselines WHERE session_id = ?")
      .run(sessionId);
  }

  reconcile(): void {
    const rows = this.#db
      .prepare(
        `SELECT * FROM sessions
         WHERE lifecycle != 'idle' OR active_run_id IS NOT NULL`,
      )
      .all() as unknown as SessionRow[];
    for (const row of rows) {
      if (!row.active_run_id) {
        this.setLifecycle(row.session_id, "crashed");
        continue;
      }
      const checkpoint = this.getCheckpoint(
        row.session_id,
        row.active_run_id,
      );
      if (!checkpoint) {
        this.appendTimeline(row.session_id, row.active_run_id, {
          type: "run_end",
          status: "crashed",
        });
        this.setLifecycle(row.session_id, "crashed");
        continue;
      }
      if (
        checkpoint.phase === "awaiting_approval" ||
        checkpoint.phase === "approved_pending_exec" ||
        checkpoint.phase === "between_turns"
      ) {
        continue;
      }
      if (
        checkpoint.phase === "executing_tool" &&
        checkpoint.pendingCallId &&
        this.loadSnapshot(row.session_id).events.some(
          ({ event }) =>
            event.type === "tool_end" &&
            event.callId === checkpoint.pendingCallId,
        )
      ) {
        this.setCheckpoint({
          ...checkpoint,
          phase: "between_turns",
          updatedAt: Date.now(),
        });
        continue;
      }
      if (checkpoint.phase === "terminal") {
        this.setLifecycle(
          row.session_id,
          checkpoint.terminalStatus === "crashed" ? "crashed" : "idle",
        );
        continue;
      }
      this.appendTimeline(row.session_id, row.active_run_id, {
        type: "run_end",
        status: "crashed",
      });
      this.setCheckpoint({
        ...checkpoint,
        phase: "terminal",
        terminalStatus: "crashed",
        updatedAt: Date.now(),
      });
      this.setLifecycle(row.session_id, "crashed");
      this.#db
        .prepare("DELETE FROM pending_approvals WHERE session_id = ?")
        .run(row.session_id);
    }
    this.#db.exec(`
      DELETE FROM pending_approvals
      WHERE NOT EXISTS (
        SELECT 1 FROM run_checkpoints rc
        WHERE rc.session_id = pending_approvals.session_id
          AND rc.run_id = pending_approvals.run_id
          AND rc.phase = 'awaiting_approval'
      )
    `);
  }

  #transaction<T>(operation: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
}
