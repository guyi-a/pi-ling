import { randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  Message,
  ToolCall,
} from "@earendil-works/pi-ai";
import type { ApprovalRequest as RuntimeApprovalRequest } from "@pi-ling/coding-agent";
import { SESSION_EVENT_SCHEMA_VERSION } from "@pi-ling/contracts";
import type {
  ApprovalMode,
  CanonicalContentBlock,
  CanonicalMessage,
  SessionEvent,
  SessionEventEnvelope,
  WorkspaceListEntry,
  WorkspaceSummary,
  SessionLifecycle,
  SessionSummary,
  RuntimeKind,
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
  runtimeKind?: RuntimeKind;
  lastDurableSeq?: number;
  projectionVersion?: number;
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

export interface StoredRuntimeSession {
  sessionId: string;
  runtimeKind: RuntimeKind;
  externalSessionId?: string;
  lastSyncedCanonicalSeq: number;
  runtimeStatus: "detached" | "active" | "idle" | "error";
  projectionVersion: number;
  runtimeVersion?: string;
  updatedAt: number;
}

interface SessionRow {
  session_id: string;
  workspace_id: string | null;
  workspace_root: string;
  workspace_name?: string;
  canonical_root?: string;
  title: string;
  lifecycle: SessionLifecycle;
  approval_mode: ApprovalMode;
  runtime_kind: RuntimeKind;
  runtime_version: string | null;
  runtime_session_id: string | null;
  pinned_at: number | null;
  archived_at: number | null;
  active_run_id: string | null;
  last_seq: number;
  last_event_seq: number;
  created_at: number;
  updated_at: number;
}

interface WorkspaceRow {
  workspace_id: string;
  root: string;
  root_key: string;
  name: string;
  created_at: number;
  updated_at: number;
  last_opened_at: number | null;
}

function normalizeWorkspaceRoot(root: string): string {
  return path.normalize(path.resolve(root));
}

function workspaceRootKey(root: string): string {
  const normalized = normalizeWorkspaceRoot(root);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function workspaceFromRow(row: WorkspaceRow): WorkspaceSummary {
  return {
    id: row.workspace_id,
    root: row.root,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_opened_at ? { lastOpenedAt: row.last_opened_at } : {}),
  };
}

function sessionFromRow(row: SessionRow): SessionSummary {
  if (!row.workspace_id) {
    throw new Error(`Session has no workspace: ${row.session_id}`);
  }
  const root = row.canonical_root ?? row.workspace_root;
  return {
    id: row.session_id,
    workspaceId: row.workspace_id,
    title: row.title,
    workspace: {
      root,
      name: row.workspace_name ?? path.basename(root),
    },
    lifecycle: row.lifecycle,
    approvalMode: row.approval_mode,
    runtimeKind: row.runtime_kind,
    ...(row.runtime_version ? { runtimeVersion: row.runtime_version } : {}),
    ...(row.pinned_at ? { pinnedAt: row.pinned_at } : {}),
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function canonicalFromMessage(
  message: Message,
  id: string,
  runtimeKind: RuntimeKind,
  createdAt: number,
): CanonicalMessage {
  const content: CanonicalContentBlock[] = [];
  if (message.role === "user") {
    if (typeof message.content === "string") {
      content.push({ type: "text", text: message.content });
    } else {
      for (const block of message.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else {
          content.push({
            type: "attachment",
            attachmentId: `inline:${id}`,
            mediaType: block.mimeType,
          });
        }
      }
    }
    return {
      id,
      role: "user",
      content,
      sourceRuntime: runtimeKind,
      createdAt,
      rawPayload: { native: message },
    };
  }
  if (message.role === "assistant") {
    for (const block of message.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        content.push({ type: "reasoning", text: block.thinking });
      } else {
        content.push({
          type: "tool-call",
          toolCallId: block.id,
          name: block.name,
          input: block.arguments,
        });
      }
    }
    return {
      id,
      role: "assistant",
      content,
      sourceRuntime: runtimeKind,
      createdAt,
      rawPayload: { native: message },
    };
  }
  for (const block of message.content) {
    if (block.type === "text") {
      content.push({
        type: "tool-result",
        toolCallId: message.toolCallId,
        content: block.text,
        isError: message.isError,
      });
    }
  }
  return {
    id,
    role: "tool",
    content,
    sourceRuntime: runtimeKind,
    createdAt,
    rawPayload: { native: message },
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
    if (!columns.some((column) => column.name === "runtime_kind")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN runtime_kind TEXT NOT NULL DEFAULT 'native'",
      );
    }
    if (!columns.some((column) => column.name === "runtime_version")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN runtime_version TEXT",
      );
    }
    if (!columns.some((column) => column.name === "runtime_session_id")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN runtime_session_id TEXT",
      );
    }
    if (!columns.some((column) => column.name === "workspace_id")) {
      this.#db.exec("ALTER TABLE sessions ADD COLUMN workspace_id TEXT");
    }
    if (!columns.some((column) => column.name === "pinned_at")) {
      this.#db.exec("ALTER TABLE sessions ADD COLUMN pinned_at INTEGER");
    }
    if (!columns.some((column) => column.name === "archived_at")) {
      this.#db.exec("ALTER TABLE sessions ADD COLUMN archived_at INTEGER");
    }
    if (!columns.some((column) => column.name === "last_event_seq")) {
      this.#db.exec(
        "ALTER TABLE sessions ADD COLUMN last_event_seq INTEGER NOT NULL DEFAULT 0",
      );
    }
    const checkpointColumns = this.#db
      .prepare("PRAGMA table_info(run_checkpoints)")
      .all() as unknown as Array<{ name: string }>;
    if (!checkpointColumns.some((column) => column.name === "runtime_kind")) {
      this.#db.exec(
        "ALTER TABLE run_checkpoints ADD COLUMN runtime_kind TEXT",
      );
    }
    if (
      !checkpointColumns.some((column) => column.name === "last_durable_seq")
    ) {
      this.#db.exec(
        "ALTER TABLE run_checkpoints ADD COLUMN last_durable_seq INTEGER",
      );
    }
    if (
      !checkpointColumns.some((column) => column.name === "projection_version")
    ) {
      this.#db.exec(
        "ALTER TABLE run_checkpoints ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 1",
      );
    }
    this.#migrateWorkspaces();
    this.#db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_sidebar
      ON sessions(workspace_id, archived_at, pinned_at DESC, updated_at DESC)
    `);
    this.#migrateRuntimeSessions();
    this.#migrateSessionEvents();
  }

  close(): void {
    this.#db.close();
  }

  createSession(input: {
    id?: string;
    workspaceId?: string;
    workspaceRoot?: string;
    title?: string;
    runtimeKind?: RuntimeKind;
    runtimeVersion?: string;
  }): SessionSummary {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const workspace = input.workspaceId
      ? this.getWorkspace(input.workspaceId)
      : input.workspaceRoot
        ? this.createWorkspace({ root: input.workspaceRoot })
        : undefined;
    if (!workspace) {
      throw new Error("A valid workspace is required");
    }
    const title = input.title?.trim() || workspace.name;
    this.#db
      .prepare(
        `INSERT INTO sessions
          (session_id, workspace_id, workspace_root, title, lifecycle,
           runtime_kind, runtime_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'idle', ?, ?, ?, ?)`,
      )
      .run(
        id,
        workspace.id,
        workspace.root,
        title,
        input.runtimeKind ?? "native",
        input.runtimeVersion ?? null,
        now,
        now,
      );
    this.upsertRuntimeSession({
      sessionId: id,
      runtimeKind: input.runtimeKind ?? "native",
      ...(input.runtimeVersion ? { runtimeVersion: input.runtimeVersion } : {}),
    });
    this.touchWorkspace(workspace.id, now);
    return this.getSession(id)!;
  }

  getSession(sessionId: string): SessionSummary | undefined {
    const row = this.#db
      .prepare(
        `SELECT s.*, w.name AS workspace_name, w.root AS canonical_root
         FROM sessions s
         JOIN workspaces w ON w.workspace_id = s.workspace_id
         WHERE s.session_id = ?`,
      )
      .get(sessionId) as SessionRow | undefined;
    return row ? sessionFromRow(row) : undefined;
  }

  listSessions(includeArchived = false): SessionSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT s.*, w.name AS workspace_name, w.root AS canonical_root
         FROM sessions s
         JOIN workspaces w ON w.workspace_id = s.workspace_id
         ${includeArchived ? "" : "WHERE s.archived_at IS NULL"}
         ORDER BY
           CASE WHEN s.pinned_at IS NULL THEN 1 ELSE 0 END,
           s.pinned_at DESC,
           s.updated_at DESC,
           s.rowid DESC`,
      )
      .all() as unknown as SessionRow[];
    return rows.map(sessionFromRow);
  }

  createWorkspace(input: {
    root: string;
    name?: string;
  }): WorkspaceSummary {
    const root = normalizeWorkspaceRoot(input.root);
    const rootKey = workspaceRootKey(root);
    const existing = this.#db
      .prepare("SELECT * FROM workspaces WHERE root_key = ?")
      .get(rootKey) as WorkspaceRow | undefined;
    if (existing) {
      this.touchWorkspace(existing.workspace_id);
      return this.getWorkspace(existing.workspace_id)!;
    }
    const now = Date.now();
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO workspaces
          (workspace_id, root, root_key, name, created_at, updated_at,
           last_opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        root,
        rootKey,
        input.name?.trim() || path.basename(root),
        now,
        now,
        now,
      );
    return this.getWorkspace(id)!;
  }

  getWorkspace(workspaceId: string): WorkspaceSummary | undefined {
    const row = this.#db
      .prepare("SELECT * FROM workspaces WHERE workspace_id = ?")
      .get(workspaceId) as WorkspaceRow | undefined;
    return row ? workspaceFromRow(row) : undefined;
  }

  listWorkspaces(includeArchived = false): WorkspaceListEntry[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM workspaces
         ORDER BY COALESCE(last_opened_at, updated_at) DESC, name ASC`,
      )
      .all() as unknown as WorkspaceRow[];
    return rows.map((row) => ({
      ...workspaceFromRow(row),
      sessions: this.#listWorkspaceSessions(
        row.workspace_id,
        includeArchived,
      ),
    }));
  }

  touchWorkspace(workspaceId: string, timestamp = Date.now()): void {
    this.#db
      .prepare(
        `UPDATE workspaces
         SET last_opened_at = ?, updated_at = ?
         WHERE workspace_id = ?`,
      )
      .run(timestamp, timestamp, workspaceId);
  }

  setSessionPinned(sessionId: string, pinned: boolean): SessionSummary {
    const result = this.#db
      .prepare(
        `UPDATE sessions SET pinned_at = ?, updated_at = ?
         WHERE session_id = ? AND archived_at IS NULL`,
      )
      .run(pinned ? Date.now() : null, Date.now(), sessionId);
    if (result.changes === 0) {
      throw new Error(`Active session not found: ${sessionId}`);
    }
    return this.getSession(sessionId)!;
  }

  archiveSession(sessionId: string): SessionSummary {
    const now = Date.now();
    const result = this.#db
      .prepare(
        `UPDATE sessions
         SET archived_at = ?, pinned_at = NULL, updated_at = ?
         WHERE session_id = ? AND archived_at IS NULL`,
      )
      .run(now, now, sessionId);
    if (result.changes === 0) {
      throw new Error(`Active session not found: ${sessionId}`);
    }
    return this.getSession(sessionId)!;
  }

  restoreSession(sessionId: string): SessionSummary {
    const now = Date.now();
    const result = this.#db
      .prepare(
        `UPDATE sessions
         SET archived_at = NULL, updated_at = ?
         WHERE session_id = ? AND archived_at IS NOT NULL`,
      )
      .run(now, sessionId);
    if (result.changes === 0) {
      throw new Error(`Archived session not found: ${sessionId}`);
    }
    return this.getSession(sessionId)!;
  }

  deleteSession(sessionId: string): void {
    this.#db
      .prepare("DELETE FROM sessions WHERE session_id = ?")
      .run(sessionId);
  }

  appendSessionEvent(input: {
    sessionId: string;
    runtimeKind: RuntimeKind;
    event: SessionEvent;
    emittedAt?: number;
    idempotencyKey?: string;
    runId?: string;
    turnId?: string;
    messageId?: string;
    toolCallId?: string;
    rawPayload?: Record<string, unknown>;
  }): SessionEventEnvelope {
    return this.#transaction(() => {
      if (input.idempotencyKey) {
        const existing = this.#db
          .prepare(
            `SELECT * FROM session_events
             WHERE session_id = ? AND idempotency_key = ?`,
          )
          .get(input.sessionId, input.idempotencyKey) as
          | Record<string, unknown>
          | undefined;
        if (existing) return this.#sessionEventFromRow(existing);
      }
      const session = this.#db
        .prepare(
          "SELECT last_event_seq FROM sessions WHERE session_id = ?",
        )
        .get(input.sessionId) as { last_event_seq: number } | undefined;
      if (!session) throw new Error(`Session not found: ${input.sessionId}`);
      const seq = session.last_event_seq + 1;
      const emittedAt = input.emittedAt ?? Date.now();
      this.#db
        .prepare(
          `INSERT INTO session_events
            (session_id, seq, schema_version, event_kind, run_id, turn_id,
             message_id, tool_call_id, runtime_kind, emitted_at,
             idempotency_key, payload_json, raw_payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.sessionId,
          seq,
          SESSION_EVENT_SCHEMA_VERSION,
          input.event.kind,
          input.runId ?? null,
          input.turnId ?? null,
          input.messageId ?? null,
          input.toolCallId ?? null,
          input.runtimeKind,
          emittedAt,
          input.idempotencyKey ?? null,
          JSON.stringify(input.event),
          input.rawPayload ? JSON.stringify(input.rawPayload) : null,
        );
      this.#db
        .prepare(
          `UPDATE sessions
           SET last_event_seq = ?, updated_at = ?
           WHERE session_id = ?`,
        )
        .run(seq, emittedAt, input.sessionId);
      this.#db
        .prepare(
          `UPDATE runtime_sessions
           SET last_synced_canonical_seq = MAX(last_synced_canonical_seq, ?),
               updated_at = ?
           WHERE session_id = ? AND runtime_kind = ?`,
        )
        .run(seq, emittedAt, input.sessionId, input.runtimeKind);
      return {
        sessionId: input.sessionId,
        seq,
        schemaVersion: SESSION_EVENT_SCHEMA_VERSION,
        runtimeKind: input.runtimeKind,
        emittedAt,
        event: input.event,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.turnId ? { turnId: input.turnId } : {}),
        ...(input.messageId ? { messageId: input.messageId } : {}),
        ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
        ...(input.rawPayload ? { rawPayload: input.rawPayload } : {}),
      };
    });
  }

  loadSessionEvents(sessionId: string): SessionEventEnvelope[] {
    const rows = this.#db
      .prepare(
        `SELECT * FROM session_events
         WHERE session_id = ? ORDER BY seq`,
      )
      .all(sessionId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => this.#sessionEventFromRow(row));
  }

  getRuntimeSession(
    sessionId: string,
    runtimeKind: RuntimeKind,
  ): StoredRuntimeSession | undefined {
    const row = this.#db
      .prepare(
        `SELECT * FROM runtime_sessions
         WHERE session_id = ? AND runtime_kind = ?`,
      )
      .get(sessionId, runtimeKind) as
      | {
          session_id: string;
          runtime_kind: RuntimeKind;
          external_session_id: string | null;
          last_synced_canonical_seq: number;
          runtime_status: StoredRuntimeSession["runtimeStatus"];
          projection_version: number;
          runtime_version: string | null;
          updated_at: number;
        }
      | undefined;
    return row
      ? {
          sessionId: row.session_id,
          runtimeKind: row.runtime_kind,
          lastSyncedCanonicalSeq: row.last_synced_canonical_seq,
          runtimeStatus: row.runtime_status,
          projectionVersion: row.projection_version,
          updatedAt: row.updated_at,
          ...(row.external_session_id
            ? { externalSessionId: row.external_session_id }
            : {}),
          ...(row.runtime_version ? { runtimeVersion: row.runtime_version } : {}),
        }
      : undefined;
  }

  upsertRuntimeSession(input: {
    sessionId: string;
    runtimeKind: RuntimeKind;
    externalSessionId?: string;
    lastSyncedCanonicalSeq?: number;
    runtimeStatus?: StoredRuntimeSession["runtimeStatus"];
    projectionVersion?: number;
    runtimeVersion?: string;
  }): StoredRuntimeSession {
    const previous = this.getRuntimeSession(input.sessionId, input.runtimeKind);
    const now = Date.now();
    this.#db
      .prepare(
        `INSERT INTO runtime_sessions
          (session_id, runtime_kind, external_session_id,
           last_synced_canonical_seq, runtime_status, projection_version,
           runtime_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, runtime_kind) DO UPDATE SET
           external_session_id = excluded.external_session_id,
           last_synced_canonical_seq = excluded.last_synced_canonical_seq,
           runtime_status = excluded.runtime_status,
           projection_version = excluded.projection_version,
           runtime_version = excluded.runtime_version,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.sessionId,
        input.runtimeKind,
        input.externalSessionId ?? previous?.externalSessionId ?? null,
        input.lastSyncedCanonicalSeq ??
          previous?.lastSyncedCanonicalSeq ??
          0,
        input.runtimeStatus ?? previous?.runtimeStatus ?? "detached",
        input.projectionVersion ?? previous?.projectionVersion ?? 1,
        input.runtimeVersion ?? previous?.runtimeVersion ?? null,
        now,
      );
    return this.getRuntimeSession(input.sessionId, input.runtimeKind)!;
  }

  appendRuntimeProjection(input: {
    sessionId: string;
    runtimeKind: RuntimeKind;
    entry: Record<string, unknown>;
    entryUuid?: string;
    subpath?: string;
  }): number {
    return this.#transaction(() => {
      const subpath = input.subpath ?? "";
      if (input.entryUuid) {
        const existing = this.#db
          .prepare(
            `SELECT entry_seq FROM runtime_projection_entries
             WHERE session_id = ? AND runtime_kind = ?
               AND subpath = ? AND entry_uuid = ?`,
          )
          .get(
            input.sessionId,
            input.runtimeKind,
            subpath,
            input.entryUuid,
          ) as { entry_seq: number } | undefined;
        if (existing) return existing.entry_seq;
      }
      const current = this.#db
        .prepare(
          `SELECT COALESCE(MAX(entry_seq), 0) AS seq
           FROM runtime_projection_entries
           WHERE session_id = ? AND runtime_kind = ? AND subpath = ?`,
        )
        .get(input.sessionId, input.runtimeKind, subpath) as { seq: number };
      const seq = current.seq + 1;
      this.#db
        .prepare(
          `INSERT OR IGNORE INTO runtime_projection_entries
            (session_id, runtime_kind, subpath, entry_seq, entry_uuid,
             entry_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.sessionId,
          input.runtimeKind,
          subpath,
          seq,
          input.entryUuid ?? null,
          JSON.stringify(input.entry),
          Date.now(),
        );
      return seq;
    });
  }

  loadRuntimeProjection(
    sessionId: string,
    runtimeKind: RuntimeKind,
    subpath = "",
  ): Record<string, unknown>[] {
    const rows = this.#db
      .prepare(
        `SELECT entry_json FROM runtime_projection_entries
         WHERE session_id = ? AND runtime_kind = ? AND subpath = ?
         ORDER BY entry_seq`,
      )
      .all(sessionId, runtimeKind, subpath) as unknown as Array<{
      entry_json: string;
    }>;
    return rows.map(
      (row) => JSON.parse(row.entry_json) as Record<string, unknown>,
    );
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

  setRuntimeSessionId(sessionId: string, runtimeSessionId: string): void {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    this.#db
      .prepare(
        `UPDATE sessions SET runtime_session_id = ?, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(runtimeSessionId, Date.now(), sessionId);
    this.upsertRuntimeSession({
      sessionId,
      runtimeKind: session.runtimeKind,
      externalSessionId: runtimeSessionId,
      runtimeStatus: "idle",
    });
  }

  getRuntimeSessionId(sessionId: string): string | undefined {
    const session = this.getSession(sessionId);
    if (session) {
      const mapped = this.getRuntimeSession(sessionId, session.runtimeKind);
      if (mapped?.externalSessionId) return mapped.externalSessionId;
    }
    const row = this.#db
      .prepare(
        "SELECT runtime_session_id FROM sessions WHERE session_id = ?",
      )
      .get(sessionId) as { runtime_session_id: string | null } | undefined;
    return row?.runtime_session_id ?? undefined;
  }

  setRuntime(
    sessionId: string,
    runtimeKind: RuntimeKind,
    runtimeVersion: string,
  ): SessionSummary {
    this.#db
      .prepare(
        `UPDATE sessions
         SET runtime_kind = ?, runtime_version = ?, updated_at = ?
         WHERE session_id = ?`,
      )
      .run(runtimeKind, runtimeVersion, Date.now(), sessionId);
    this.upsertRuntimeSession({
      sessionId,
      runtimeKind,
      runtimeVersion,
    });
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  setCheckpoint(checkpoint: RunCheckpoint): void {
    const previous = this.getCheckpoint(
      checkpoint.sessionId,
      checkpoint.runId,
    );
    this.#db
      .prepare(
        `INSERT INTO run_checkpoints
          (session_id, run_id, phase, terminal_status, turn_id,
           pending_call_id, pending_tool_json, pending_approval_json,
           runtime_kind, last_durable_seq, projection_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, run_id) DO UPDATE SET
           phase = excluded.phase,
           terminal_status = excluded.terminal_status,
           turn_id = excluded.turn_id,
           pending_call_id = excluded.pending_call_id,
           pending_tool_json = excluded.pending_tool_json,
           pending_approval_json = excluded.pending_approval_json,
           runtime_kind = excluded.runtime_kind,
           last_durable_seq = excluded.last_durable_seq,
           projection_version = excluded.projection_version,
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
        checkpoint.runtimeKind ?? previous?.runtimeKind ?? null,
        checkpoint.lastDurableSeq ?? previous?.lastDurableSeq ?? null,
        checkpoint.projectionVersion ?? previous?.projectionVersion ?? 1,
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
          runtime_kind: RuntimeKind | null;
          last_durable_seq: number | null;
          projection_version: number;
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
      ...(row.runtime_kind ? { runtimeKind: row.runtime_kind } : {}),
      ...(row.last_durable_seq !== null
        ? { lastDurableSeq: row.last_durable_seq }
        : {}),
      projectionVersion: row.projection_version,
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
        this.appendSessionEvent({
          sessionId: row.session_id,
          runtimeKind: row.runtime_kind,
          runId: row.active_run_id,
          idempotencyKey: `run:${row.active_run_id}:end`,
          event: { kind: "run.ended", status: "crashed" },
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
        this.loadSessionEvents(row.session_id).some(
          ({ event }) =>
            event.kind === "tool.result.committed" &&
            event.result.toolCallId === checkpoint.pendingCallId,
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
      const durable = this.appendSessionEvent({
        sessionId: row.session_id,
        runtimeKind: row.runtime_kind,
        runId: row.active_run_id,
        idempotencyKey: `run:${row.active_run_id}:end`,
        event: { kind: "run.ended", status: "crashed" },
      });
      this.setCheckpoint({
        ...checkpoint,
        phase: "terminal",
        terminalStatus: "crashed",
        runtimeKind: row.runtime_kind,
        lastDurableSeq: durable.seq,
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

  #sessionEventFromRow(row: Record<string, unknown>): SessionEventEnvelope {
    return {
      sessionId: String(row["session_id"]),
      seq: Number(row["seq"]),
      schemaVersion: Number(row["schema_version"]),
      runtimeKind: row["runtime_kind"] as RuntimeKind,
      emittedAt: Number(row["emitted_at"]),
      event: JSON.parse(String(row["payload_json"])) as SessionEvent,
      ...(typeof row["idempotency_key"] === "string"
        ? { idempotencyKey: row["idempotency_key"] }
        : {}),
      ...(typeof row["run_id"] === "string" ? { runId: row["run_id"] } : {}),
      ...(typeof row["turn_id"] === "string"
        ? { turnId: row["turn_id"] }
        : {}),
      ...(typeof row["message_id"] === "string"
        ? { messageId: row["message_id"] }
        : {}),
      ...(typeof row["tool_call_id"] === "string"
        ? { toolCallId: row["tool_call_id"] }
        : {}),
      ...(typeof row["raw_payload_json"] === "string"
        ? {
            rawPayload: JSON.parse(row["raw_payload_json"]) as Record<
              string,
              unknown
            >,
          }
        : {}),
    };
  }

  #migrateRuntimeSessions(): void {
    const rows = this.#db
      .prepare(
        `SELECT session_id, runtime_kind, runtime_version,
                runtime_session_id, last_event_seq
         FROM sessions`,
      )
      .all() as unknown as Array<{
      session_id: string;
      runtime_kind: RuntimeKind;
      runtime_version: string | null;
      runtime_session_id: string | null;
      last_event_seq: number;
    }>;
    for (const row of rows) {
      this.upsertRuntimeSession({
        sessionId: row.session_id,
        runtimeKind: row.runtime_kind,
        ...(row.runtime_version ? { runtimeVersion: row.runtime_version } : {}),
        ...(row.runtime_session_id
          ? { externalSessionId: row.runtime_session_id }
          : {}),
        lastSyncedCanonicalSeq: row.last_event_seq,
      });
    }
  }

  #migrateSessionEvents(): void {
    const sessions = this.listSessions(true);
    for (const session of sessions) {
      const count = this.#db
        .prepare(
          "SELECT COUNT(*) AS count FROM session_events WHERE session_id = ?",
        )
        .get(session.id) as { count: number };
      if (count.count > 0) continue;

      const storedMessages = this.#db
        .prepare(
          `SELECT turn_id, message_json, created_at
           FROM agent_messages
           WHERE session_id = ? AND role = 'assistant'`,
        )
        .all(session.id) as unknown as Array<{
        turn_id: string | null;
        message_json: string;
        created_at: number;
      }>;
      const assistantByTurn = new Map(
        storedMessages
          .filter((row) => row.turn_id)
          .map((row) => [
            row.turn_id!,
            {
              message: JSON.parse(row.message_json) as Message,
              createdAt: row.created_at,
            },
          ]),
      );
      const text = new Map<string, string>();
      const reasoning = new Map<string, string>();
      const tools = new Map<
        string,
        { name: string; input: Record<string, unknown> }
      >();
      const legacy = this.loadSnapshot(session.id).events;

      for (const envelope of legacy) {
        const event = envelope.event;
        const base = {
          sessionId: session.id,
          runtimeKind: session.runtimeKind,
          emittedAt: envelope.emittedAt,
          runId: envelope.runId,
          rawPayload: { migration: { timelineSeq: envelope.seq } },
        };
        if (event.type === "run_start") {
          const message: CanonicalMessage = {
            id: event.userItemId,
            role: "user",
            content: [{ type: "text", text: event.prompt }],
            sourceRuntime: session.runtimeKind,
            createdAt: envelope.emittedAt,
          };
          this.appendSessionEvent({
            ...base,
            messageId: message.id,
            idempotencyKey: `run:${envelope.runId}:start`,
            event: { kind: "run.started", userMessage: message },
          });
        } else if (event.type === "run_end") {
          this.appendSessionEvent({
            ...base,
            idempotencyKey: `run:${envelope.runId}:end`,
            event: { kind: "run.ended", status: event.status },
          });
        } else if (event.type === "turn_start") {
          this.appendSessionEvent({
            ...base,
            turnId: event.turnId,
            idempotencyKey: `turn:${event.turnId}:start`,
            event: { kind: "turn.started", turn: event.turn },
          });
        } else if (event.type === "turn_end") {
          this.appendSessionEvent({
            ...base,
            turnId: event.turnId,
            idempotencyKey: `turn:${event.turnId}:end`,
            event: { kind: "turn.ended" },
          });
        } else if (event.type === "assistant_text_delta") {
          text.set(event.itemId, (text.get(event.itemId) ?? "") + event.delta);
        } else if (event.type === "assistant_thinking_delta") {
          reasoning.set(
            event.itemId,
            (reasoning.get(event.itemId) ?? "") + event.delta,
          );
        } else if (event.type === "assistant_end") {
          const stored = assistantByTurn.get(event.turnId);
          const message = stored
            ? canonicalFromMessage(
                stored.message,
                event.itemId,
                session.runtimeKind,
                stored.createdAt,
              )
            : {
                id: event.itemId,
                role: "assistant" as const,
                content: [
                  ...(reasoning.get(event.itemId)
                    ? [
                        {
                          type: "reasoning" as const,
                          text: reasoning.get(event.itemId)!,
                        },
                      ]
                    : []),
                  ...(text.get(event.itemId)
                    ? [
                        {
                          type: "text" as const,
                          text: text.get(event.itemId)!,
                        },
                      ]
                    : []),
                ],
                sourceRuntime: session.runtimeKind,
                createdAt: envelope.emittedAt,
              };
          this.appendSessionEvent({
            ...base,
            turnId: event.turnId,
            messageId: event.itemId,
            idempotencyKey: `assistant:${event.turnId}`,
            event: {
              kind: "message.assistant.committed",
              message,
              stopReason: event.stopReason,
              usage: event.usage,
              ...(event.error ? { error: event.error } : {}),
            },
          });
        } else if (event.type === "tool_requested") {
          tools.set(event.callId, {
            name: event.tool,
            input: event.arguments,
          });
          this.appendSessionEvent({
            ...base,
            turnId: event.turnId,
            toolCallId: event.callId,
            idempotencyKey: `tool:${event.callId}:call`,
            event: {
              kind: "tool.call.committed",
              toolCall: {
                id: event.callId,
                name: event.tool,
                input: event.arguments,
              },
            },
          });
        } else if (event.type === "tool_start") {
          this.appendSessionEvent({
            ...base,
            turnId: event.turnId,
            toolCallId: event.callId,
            idempotencyKey: `tool:${event.callId}:start`,
            event: {
              kind: "tool.execution.started",
              toolCallId: event.callId,
            },
          });
        } else if (event.type === "tool_end") {
          this.appendSessionEvent({
            ...base,
            turnId: event.turnId,
            toolCallId: event.callId,
            messageId: `tool:${event.callId}`,
            idempotencyKey: `tool:${event.callId}:result`,
            event: {
              kind: "tool.result.committed",
              result: {
                toolCallId: event.callId,
                content: event.output,
                isError: event.isError,
                rawPayload: { tool: tools.get(event.callId)?.name ?? event.tool },
              },
            },
          });
        } else if (event.type === "approval_requested") {
          this.appendSessionEvent({
            ...base,
            turnId: event.turnId,
            toolCallId: event.approval.callId,
            idempotencyKey: `approval:${event.approval.callId}:requested`,
            event: {
              kind: "approval.requested",
              toolItemId: event.toolItemId,
              approval: event.approval,
            },
          });
        } else if (event.type === "approval_resolved") {
          this.appendSessionEvent({
            ...base,
            turnId: event.turnId,
            toolCallId: event.callId,
            idempotencyKey: `approval:${event.callId}:resolved`,
            event: {
              kind: "approval.resolved",
              toolItemId: event.toolItemId,
              callId: event.callId,
              approved: event.approved,
            },
          });
        } else if (event.type === "changes") {
          this.appendSessionEvent({
            ...base,
            turnId: event.turnId,
            toolCallId: event.callId,
            idempotencyKey: `changes:${event.callId}`,
            event: {
              kind: "changes.committed",
              callId: event.callId,
              files: event.files,
            },
          });
        }
      }
      const latest = this.loadSessionEvents(session.id).at(-1)?.seq ?? 0;
      this.upsertRuntimeSession({
        sessionId: session.id,
        runtimeKind: session.runtimeKind,
        lastSyncedCanonicalSeq: latest,
      });
    }
  }

  #listWorkspaceSessions(
    workspaceId: string,
    includeArchived: boolean,
  ): SessionSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT s.*, w.name AS workspace_name, w.root AS canonical_root
         FROM sessions s
         JOIN workspaces w ON w.workspace_id = s.workspace_id
         WHERE s.workspace_id = ?
           ${includeArchived ? "" : "AND s.archived_at IS NULL"}
         ORDER BY
           CASE WHEN s.pinned_at IS NULL THEN 1 ELSE 0 END,
           s.pinned_at DESC,
           s.updated_at DESC,
           s.rowid DESC`,
      )
      .all(workspaceId) as unknown as SessionRow[];
    return rows.map(sessionFromRow);
  }

  #migrateWorkspaces(): void {
    this.#transaction(() => {
      const sessions = this.#db
        .prepare(
          `SELECT session_id, workspace_root, created_at, updated_at
           FROM sessions`,
        )
        .all() as unknown as Array<{
        session_id: string;
        workspace_root: string;
        created_at: number;
        updated_at: number;
      }>;
      for (const session of sessions) {
        const root = normalizeWorkspaceRoot(session.workspace_root);
        const rootKey = workspaceRootKey(root);
        let workspace = this.#db
          .prepare("SELECT * FROM workspaces WHERE root_key = ?")
          .get(rootKey) as WorkspaceRow | undefined;
        if (!workspace) {
          const id = randomUUID();
          this.#db
            .prepare(
              `INSERT INTO workspaces
                (workspace_id, root, root_key, name, created_at, updated_at,
                 last_opened_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              root,
              rootKey,
              path.basename(root),
              session.created_at,
              session.updated_at,
              session.updated_at,
            );
          workspace = this.#db
            .prepare("SELECT * FROM workspaces WHERE workspace_id = ?")
            .get(id) as unknown as WorkspaceRow;
        } else {
          this.#db
            .prepare(
              `UPDATE workspaces
               SET updated_at = MAX(updated_at, ?),
                   last_opened_at = MAX(COALESCE(last_opened_at, 0), ?)
               WHERE workspace_id = ?`,
            )
            .run(
              session.updated_at,
              session.updated_at,
              workspace.workspace_id,
            );
        }
        this.#db
          .prepare(
            `UPDATE sessions
             SET workspace_id = ?, workspace_root = ?
             WHERE session_id = ?`,
          )
          .run(workspace.workspace_id, workspace.root, session.session_id);
      }
      const orphan = this.#db
        .prepare(
          "SELECT COUNT(*) AS count FROM sessions WHERE workspace_id IS NULL",
        )
        .get() as { count: number };
      if (orphan.count > 0) {
        throw new Error(`Workspace migration left ${orphan.count} sessions`);
      }
    });
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
