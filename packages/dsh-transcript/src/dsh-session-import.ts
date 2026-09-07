/**
 * Sidecar plugin for方案 B: pre-materializes a canonical seed into DSH
 * persistence, then lets the standard ACP `session/resume` reopen it.
 *
 * Loaded by the pinned DSH sidecar through the profile patch. It polls the
 * versioned `DSH_HOME/pi-ling-import/` directory for JSON request files and
 * drives the injected `agents`/`sessions`/`sessionPersistence` services.
 * On success it writes the request's `doneFile` and removes the request; on
 * failure it writes `${request}.error` and keeps the request for inspection.
 *
 * Two request modes:
 *
 *   mode: "import" — create a fresh session with the full seed
 *   mode: "append" — append a delta to an existing persisted session
 *
 * Request shape (`{DSH_HOME}/pi-ling-import/*.json`):
 *
 *   {
 *     mode: "import" | "append",
 *     sessionId: string,
 *     cwd: string,
 *     provider: string,
 *     model: string,
 *     canonicalMessages: CanonicalMessage[],
 *     startTurn: number,   // append mode only
 *     doneFile: string
 *   }
 */

import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CanonicalMessage } from "@pi-ling/contracts";

import { toDshSeed } from "./index.js";

interface SeedImportPayload {
  mode: "import" | "append";
  sessionId: string;
  cwd: string;
  provider: string;
  model: string;
  canonicalMessages: readonly CanonicalMessage[];
  startTurn?: number;
  doneFile: string;
}

interface DshAgentHandle {
  agent: { session: unknown };
  dispose(): Promise<void>;
}

interface SeedImportAgents {
  create(options: {
    sessionId: unknown;
    seed: unknown;
    meta: unknown;
    agentOptions: unknown;
  }): Promise<DshAgentHandle>;
}

interface SeedImportSessions {
  flush(session: unknown): Promise<unknown>;
}

interface SessionHandle {
  read(offset?: number): Promise<readonly { seq: number }[]>;
  append(events: readonly unknown[]): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

interface SeedImportPersistence {
  open(id: unknown, access: "write"): Promise<SessionHandle>;
}

interface SeedImportContext {
  agents: SeedImportAgents;
  sessions: SeedImportSessions;
  sessionPersistence: SeedImportPersistence;
  effect(disposer: () => () => void): unknown;
}

export const name = "pi-ling-session-import";
export const inject = ["agents", "sessions", "sessionPersistence"];

const POLL_INTERVAL_MS = 100;

function importDirectory(): string | undefined {
  const home = process.env["DSH_HOME"];
  if (!home) return undefined;
  return path.join(home, "pi-ling-import");
}

export async function apply(ctx: SeedImportContext): Promise<void> {
  const directory = importDirectory();
  if (!directory) return;
  const processing = new Set<string>();

  const importFresh = async (payload: SeedImportPayload): Promise<void> => {
    const handle = await ctx.agents.create({
      sessionId: payload.sessionId,
      seed: toDshSeed(payload.canonicalMessages, {
        provider: payload.provider,
        model: payload.model,
      }),
      meta: { cwd: payload.cwd },
      agentOptions: { provider: payload.provider, model: payload.model },
    });
    await ctx.sessions.flush(handle.agent.session);
    await handle.dispose();
  };

  const appendDelta = async (payload: SeedImportPayload): Promise<void> => {
    const handle = await ctx.sessionPersistence.open(
      payload.sessionId,
      "write",
    );
    try {
      const existing = await handle.read(0);
      const nextSeq = existing.length;
      const delta = toDshSeed(
        payload.canonicalMessages,
        { provider: payload.provider, model: payload.model },
        Date.now(),
        {
          startTurn: payload.startTurn ?? 1,
          startSeq: nextSeq,
        },
      );
      await handle.append(delta);
      await handle.flush();
    } finally {
      await handle.close();
    }
  };

  const processOne = async (file: string): Promise<void> => {
    if (processing.has(file)) return;
    processing.add(file);
    const requestPath = path.join(directory, file);
    try {
      let payload: SeedImportPayload;
      try {
        payload = JSON.parse(
          await readFile(requestPath, "utf8"),
        ) as SeedImportPayload;
      } catch (error) {
        await writeFile(`${requestPath}.error`, String(error), "utf8").catch(
          () => {},
        );
        return;
      }
      if (payload.mode === "append") {
        await appendDelta(payload);
      } else {
        await importFresh(payload);
      }
      await writeFile(payload.doneFile, "ok\n", "utf8");
      await unlink(requestPath).catch(() => {});
    } catch (error) {
      await writeFile(`${requestPath}.error`, String(error), "utf8").catch(
        () => {},
      );
    } finally {
      processing.delete(file);
    }
  };

  const poll = async (): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      return; // directory not created yet
    }
    for (const file of entries) {
      if (!file.endsWith(".json")) continue;
      await processOne(file);
    }
  };

  const timer = setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);
  void poll();

  ctx.effect(() => () => {
    clearInterval(timer);
  });
}
