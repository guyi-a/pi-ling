export const SESSION_SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS workspaces (
  workspace_id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  root_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_opened_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_workspaces_recent
  ON workspaces(last_opened_at DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(workspace_id),
  workspace_root TEXT NOT NULL,
  title TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'idle'
    CHECK (lifecycle IN ('idle', 'running', 'awaiting_approval', 'awaiting_question', 'crashed')),
  approval_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (approval_mode IN ('manual', 'accept-write', 'auto')),
  composer_mode TEXT NOT NULL DEFAULT 'agent'
    CHECK (composer_mode IN ('plan', 'ask', 'agent')),
  runtime_kind TEXT NOT NULL DEFAULT 'native'
    CHECK (runtime_kind IN ('native', 'dsh')),
  runtime_version TEXT,
  runtime_session_id TEXT,
  pinned_at INTEGER,
  archived_at INTEGER,
  active_run_id TEXT,
  parent_session_id TEXT,
  last_seq INTEGER NOT NULL DEFAULT 0,
  last_event_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated
  ON sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS session_events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  event_kind TEXT NOT NULL,
  run_id TEXT,
  turn_id TEXT,
  message_id TEXT,
  tool_call_id TEXT,
  runtime_kind TEXT NOT NULL,
  emitted_at INTEGER NOT NULL,
  idempotency_key TEXT,
  payload_json TEXT NOT NULL,
  raw_payload_json TEXT,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_idempotency
  ON session_events(session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_events_run
  ON session_events(session_id, run_id, seq);

CREATE TABLE IF NOT EXISTS runtime_sessions (
  session_id TEXT NOT NULL,
  runtime_kind TEXT NOT NULL,
  external_session_id TEXT,
  last_synced_canonical_seq INTEGER NOT NULL DEFAULT 0,
  runtime_status TEXT NOT NULL DEFAULT 'detached',
  projection_version INTEGER NOT NULL DEFAULT 1,
  runtime_version TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, runtime_kind),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runtime_projection_entries (
  session_id TEXT NOT NULL,
  runtime_kind TEXT NOT NULL,
  subpath TEXT NOT NULL DEFAULT '',
  entry_seq INTEGER NOT NULL,
  entry_uuid TEXT,
  entry_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, runtime_kind, subpath, entry_seq),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_projection_uuid
  ON runtime_projection_entries(
    session_id, runtime_kind, subpath, entry_uuid
  )
  WHERE entry_uuid IS NOT NULL;

CREATE TABLE IF NOT EXISTS timeline_events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  emitted_at INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timeline_run
  ON timeline_events(session_id, run_id, seq);

CREATE TABLE IF NOT EXISTS agent_messages (
  session_id TEXT NOT NULL,
  msg_seq INTEGER NOT NULL,
  event_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  turn_id TEXT,
  role TEXT NOT NULL,
  message_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, msg_seq),
  UNIQUE (session_id, event_key),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_checkpoints (
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  terminal_status TEXT,
  turn_id TEXT,
  pending_call_id TEXT,
  pending_tool_json TEXT,
  pending_approval_json TEXT,
  pending_question_json TEXT,
  runtime_kind TEXT,
  last_durable_seq INTEGER,
  projection_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, run_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pending_approvals (
  session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  approval_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, call_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS file_baselines (
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  existed INTEGER NOT NULL,
  content BLOB,
  size INTEGER NOT NULL,
  modified_at REAL NOT NULL,
  binary INTEGER NOT NULL,
  sensitive INTEGER NOT NULL,
  too_large INTEGER NOT NULL,
  PRIMARY KEY (session_id, path),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS background_tasks (
  task_id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  parent_run_id TEXT NOT NULL,
  parent_tool_call_id TEXT NOT NULL,
  child_session_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN (
      'pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted'
    )),
  description TEXT NOT NULL,
  summary TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  continued_at INTEGER,
  FOREIGN KEY (parent_session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_background_tasks_parent
  ON background_tasks(parent_session_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_background_tasks_status
  ON background_tasks(status);
`;
