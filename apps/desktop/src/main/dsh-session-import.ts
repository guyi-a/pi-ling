import { randomUUID } from "node:crypto";

import type { CanonicalMessage, SessionEventEnvelope } from "@pi-ling/contracts";
import type { RuntimeAdapter } from "@pi-ling/runtime-contracts";
import { projectCanonicalMessages } from "@pi-ling/session-events";

import { maybeCompactSessionBeforeRun } from "./session-compaction.js";
import type { SessionStore } from "./session-store/session-store.js";

const COMPACTION_APPLIED = ["compaction", "applied"].join(".");

import { getResolvedLlmConfig } from "./llm-config-store.js";
import { resolveDshAcpModel } from "./dsh-pi-ai-profile.js";

export async function reimportDshCanonicalHistory(options: {
  store: SessionStore;
  sessionId: string;
  workspaceRoot: string;
  runtime: RuntimeAdapter;
  canonicalMessages: readonly CanonicalMessage[];
  latestSeq: number;
}): Promise<void> {
  if (!options.runtime.importSession) {
    throw new Error("DSH runtime does not support session import");
  }
  const llmConfig = getResolvedLlmConfig();
  const newExternalId = randomUUID();
  await options.runtime.importSession({
    sessionId: newExternalId,
    workspaceRoot: options.workspaceRoot,
    provider: llmConfig.provider,
    model: resolveDshAcpModel(llmConfig.provider, llmConfig.model),
    canonicalMessages: options.canonicalMessages,
  });
  options.store.setRuntimeImport(
    options.sessionId,
    newExternalId,
    options.latestSeq,
  );
  await options.runtime.resumeSession({
    sessionId: options.sessionId,
    workspaceRoot: options.workspaceRoot,
    externalSessionId: newExternalId,
  });
}

export function dshCrossesCompactionBoundary(
  events: readonly SessionEventEnvelope[],
  watermark: number,
): boolean {
  return events.some(
    (envelope) =>
      envelope.seq > watermark && envelope.event.kind === COMPACTION_APPLIED,
  );
}

export async function maybeCompactAndReimportDshSession(options: {
  store: SessionStore;
  sessionId: string;
  workspaceRoot: string;
  runtime: RuntimeAdapter;
}): Promise<SessionEventEnvelope | undefined> {
  const compacted = await maybeCompactSessionBeforeRun(
    options.store,
    options.sessionId,
  );
  if (!compacted) return undefined;
  const events = options.store.loadSessionEvents(options.sessionId);
  await reimportDshCanonicalHistory({
    store: options.store,
    sessionId: options.sessionId,
    workspaceRoot: options.workspaceRoot,
    runtime: options.runtime,
    canonicalMessages: projectCanonicalMessages(events),
    latestSeq: events.at(-1)?.seq ?? 0,
  });
  return compacted;
}

export async function reimportDshSessionIfNeeded(options: {
  store: SessionStore;
  sessionId: string;
  workspaceRoot: string;
  runtime: RuntimeAdapter;
}): Promise<boolean> {
  const events = options.store.loadSessionEvents(options.sessionId);
  const messages = projectCanonicalMessages(events);
  const watermark =
    options.store.getRuntimeSession(options.sessionId, "dsh")
      ?.lastSyncedCanonicalSeq ?? 0;
  const externalSessionId = options.store.getRuntimeSessionId(options.sessionId);
  const needsFullProjection =
    messages.length > 0 &&
    (!externalSessionId || dshCrossesCompactionBoundary(events, watermark));
  if (!needsFullProjection || !options.runtime.importSession) {
    return false;
  }
  await reimportDshCanonicalHistory({
    store: options.store,
    sessionId: options.sessionId,
    workspaceRoot: options.workspaceRoot,
    runtime: options.runtime,
    canonicalMessages: messages,
    latestSeq: events.at(-1)?.seq ?? 0,
  });
  return true;
}
