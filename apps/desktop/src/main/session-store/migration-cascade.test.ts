import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("session lifecycle migration safety", () => {
  it("does not cascade-delete session_events when rebuilding sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-ling-mig-"));
    const filename = join(dir, "test.db");
    const db = new DatabaseSync(filename);
    db.exec(`
      PRAGMA foreign_keys = ON;
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
        pinned_at INTEGER,
        archived_at INTEGER,
        active_run_id TEXT,
        last_seq INTEGER NOT NULL DEFAULT 0,
        last_event_seq INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE session_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        event_kind TEXT NOT NULL,
        runtime_kind TEXT NOT NULL,
        emitted_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (session_id, seq),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );
    `);
    db.prepare(
      `INSERT INTO sessions
        (session_id, workspace_root, title, lifecycle, approval_mode, composer_mode,
         runtime_kind, last_seq, last_event_seq, created_at, updated_at)
       VALUES (?, ?, ?, 'idle', 'manual', 'agent', 'native', 0, 2, 1, 1)`,
    ).run("s1", "E:\\pi-ling", "pi-ling");
    db.prepare(
      `INSERT INTO session_events
        (session_id, seq, event_kind, runtime_kind, emitted_at, payload_json)
       VALUES ('s1', 1, 'run.started', 'native', 1, '{}')`,
    ).run();
    db.prepare(
      `INSERT INTO session_events
        (session_id, seq, event_kind, runtime_kind, emitted_at, payload_json)
       VALUES ('s1', 2, 'run.ended', 'native', 1, '{}')`,
    ).run();

    const columns = (
      db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    const columnList = columns.join(", ");

    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        CREATE TABLE sessions__lifecycle_migration (
          session_id TEXT PRIMARY KEY,
          workspace_root TEXT NOT NULL,
          title TEXT NOT NULL,
          lifecycle TEXT NOT NULL DEFAULT 'idle'
            CHECK (lifecycle IN ('idle', 'running', 'awaiting_approval', 'awaiting_question', 'crashed')),
          approval_mode TEXT NOT NULL DEFAULT 'manual',
          composer_mode TEXT NOT NULL DEFAULT 'agent',
          runtime_kind TEXT NOT NULL DEFAULT 'native',
          runtime_version TEXT,
          runtime_session_id TEXT,
          pinned_at INTEGER,
          archived_at INTEGER,
          active_run_id TEXT,
          last_seq INTEGER NOT NULL DEFAULT 0,
          last_event_seq INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      db.exec(`
        INSERT INTO sessions__lifecycle_migration (${columnList})
        SELECT ${columnList} FROM sessions
      `);
      db.exec("DROP TABLE sessions");
      db.exec("ALTER TABLE sessions__lifecycle_migration RENAME TO sessions");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("PRAGMA foreign_keys = ON");

    expect(
      db.prepare("SELECT COUNT(*) AS c FROM session_events").get() as {
        c: number;
      },
    ).toEqual({ c: 2 });
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("shows cascade data loss when foreign keys stay enabled during drop", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-ling-mig-"));
    const filename = join(dir, "test.db");
    const db = new DatabaseSync(filename);
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      );
      CREATE TABLE session_events (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (session_id, seq),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );
      INSERT INTO sessions VALUES ('s1', 'pi-ling');
      INSERT INTO session_events VALUES ('s1', 1, '{}');
    `);
    db.exec("DROP TABLE sessions");
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM session_events").get() as {
        c: number;
      },
    ).toEqual({ c: 0 });
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
