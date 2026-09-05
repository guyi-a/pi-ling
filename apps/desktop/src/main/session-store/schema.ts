export const SESSION_SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  title TEXT NOT NULL,
  lifecycle TEXT NOT NULL DEFAULT 'idle'
    CHECK (lifecycle IN ('idle', 'running', 'awaiting_approval', 'crashed')),
  approval_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (approval_mode IN ('manual', 'accept-write', 'auto')),
  active_run_id TEXT,
  last_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated
  ON sessions(updated_at DESC);

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
`;
