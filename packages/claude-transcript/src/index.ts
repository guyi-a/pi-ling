import { DatabaseSync } from "node:sqlite";

import type {
  SessionKey,
  SessionStore,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";

export class SqliteClaudeSessionStore implements SessionStore {
  readonly #db: DatabaseSync;
  readonly metrics = {
    appendCalls: 0,
    loadCalls: 0,
  };

  constructor(filename: string) {
    this.#db = new DatabaseSync(filename);
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS claude_session_entries (
        project_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        subpath TEXT NOT NULL DEFAULT '',
        entry_seq INTEGER NOT NULL,
        entry_uuid TEXT,
        entry_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (project_key, session_id, subpath, entry_seq)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_entry_uuid
        ON claude_session_entries(project_key, session_id, subpath, entry_uuid)
        WHERE entry_uuid IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_claude_session_recent
        ON claude_session_entries(project_key, session_id, created_at DESC);
    `);
  }

  close(): void {
    this.#db.close();
  }

  append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    this.metrics.appendCalls += 1;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const subpath = key.subpath ?? "";
      const row = this.#db
        .prepare(
          `SELECT COALESCE(MAX(entry_seq), -1) AS max_seq
           FROM claude_session_entries
           WHERE project_key = ? AND session_id = ? AND subpath = ?`,
        )
        .get(key.projectKey, key.sessionId, subpath) as { max_seq: number };
      let seq = row.max_seq + 1;
      const statement = this.#db.prepare(`
        INSERT OR IGNORE INTO claude_session_entries
          (project_key, session_id, subpath, entry_seq, entry_uuid,
           entry_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const entry of entries) {
        const result = statement.run(
          key.projectKey,
          key.sessionId,
          subpath,
          seq,
          typeof entry.uuid === "string" ? entry.uuid : null,
          JSON.stringify(entry),
          Date.now(),
        );
        if (result.changes > 0) seq += 1;
      }
      this.#db.exec("COMMIT");
      return Promise.resolve();
    } catch (error) {
      this.#db.exec("ROLLBACK");
      return Promise.reject(error);
    }
  }

  load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    this.metrics.loadCalls += 1;
    const rows = this.#db
      .prepare(
        `SELECT entry_json FROM claude_session_entries
         WHERE project_key = ? AND session_id = ? AND subpath = ?
         ORDER BY entry_seq`,
      )
      .all(
        key.projectKey,
        key.sessionId,
        key.subpath ?? "",
      ) as unknown as Array<{ entry_json: string }>;
    return Promise.resolve(
      rows.length > 0
        ? rows.map(
            (row) => JSON.parse(row.entry_json) as SessionStoreEntry,
          )
        : null,
    );
  }

  listSessions(
    projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>> {
    const rows = this.#db
      .prepare(
        `SELECT session_id, MAX(created_at) AS mtime
         FROM claude_session_entries
         WHERE project_key = ? AND subpath = ''
         GROUP BY session_id
         ORDER BY mtime DESC`,
      )
      .all(projectKey) as unknown as Array<{
      session_id: string;
      mtime: number;
    }>;
    return Promise.resolve(
      rows.map((row) => ({
        sessionId: row.session_id,
        mtime: row.mtime,
      })),
    );
  }

  listSubkeys(key: {
    projectKey: string;
    sessionId: string;
  }): Promise<string[]> {
    const rows = this.#db
      .prepare(
        `SELECT DISTINCT subpath FROM claude_session_entries
         WHERE project_key = ? AND session_id = ? AND subpath != ''
         ORDER BY subpath`,
      )
      .all(key.projectKey, key.sessionId) as unknown as Array<{
      subpath: string;
    }>;
    return Promise.resolve(rows.map((row) => row.subpath));
  }

  delete(key: SessionKey): Promise<void> {
    this.#db
      .prepare(
        `DELETE FROM claude_session_entries
         WHERE project_key = ? AND session_id = ? AND subpath = ?`,
      )
      .run(key.projectKey, key.sessionId, key.subpath ?? "");
    return Promise.resolve();
  }

  mirroredSessions(): Array<{
    projectKey: string;
    sessionId: string;
    entries: number;
  }> {
    const rows = this.#db
      .prepare(
        `SELECT project_key, session_id, COUNT(*) AS entries
         FROM claude_session_entries
         GROUP BY project_key, session_id
         ORDER BY project_key, session_id`,
      )
      .all() as unknown as Array<{
      project_key: string;
      session_id: string;
      entries: number;
    }>;
    return rows.map((row) => ({
      projectKey: row.project_key,
      sessionId: row.session_id,
      entries: row.entries,
    }));
  }
}
