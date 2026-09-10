import type { TimelineEnvelope } from "@pi-ling/contracts";

import { formatMessageUsage } from "../chat/format-message-usage";
import type { TimelineRun } from "../../timeline/reducer";

export type TraceEventTone =
  | "neutral"
  | "tool"
  | "model"
  | "approval"
  | "error"
  | "run";

export type TraceEventSummary = {
  label: string;
  tone: TraceEventTone;
  muted?: boolean;
};

export type TraceRunFilter = "active" | "all";

function truncate(text: string, max = 48): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function summarizeTimelineEvent(
  envelope: TimelineEnvelope,
): TraceEventSummary {
  const event = envelope.event;
  switch (event.type) {
    case "run_start":
      return {
        label: `run_start · "${truncate(event.prompt)}"`,
        tone: "run",
      };
    case "run_end":
      return {
        label: `run_end · ${event.status}`,
        tone: event.status === "completed" ? "run" : "error",
      };
    case "turn_start":
      return {
        label: `turn ${event.turn} start · ${shortTurnId(event.turnId)}`,
        tone: "neutral",
      };
    case "turn_end":
      return {
        label: `turn end · ${event.turnId}`,
        tone: "neutral",
        muted: true,
      };
    case "assistant_start":
      return {
        label: "assistant_start",
        tone: "model",
        muted: true,
      };
    case "assistant_text_delta":
      return {
        label: `assistant_text_delta · +${event.delta.length} chars`,
        tone: "model",
        muted: true,
      };
    case "assistant_thinking_delta":
      return {
        label: `assistant_thinking_delta · +${event.delta.length} chars`,
        tone: "model",
        muted: true,
      };
    case "assistant_end": {
      const parts = [`assistant_end · ${event.stopReason}`];
      const usageLabel = formatMessageUsage({
        ...(event.usage ? { usage: event.usage } : {}),
        ...(event.contextUsage ? { contextUsage: event.contextUsage } : {}),
      });
      if (usageLabel) {
        parts.push(usageLabel);
      }
      if (event.error) {
        parts.push(truncate(event.error, 32));
      }
      return {
        label: parts.join(" · "),
        tone: event.error ? "error" : "model",
      };
    }
    case "tool_requested":
      return {
        label: `tool_requested · ${event.tool}`,
        tone: "tool",
        muted: true,
      };
    case "tool_start":
      return {
        label: `tool_start · ${event.tool}`,
        tone: "tool",
      };
    case "tool_end":
      return {
        label: `tool_end · ${event.tool} · ${event.isError ? "error" : "ok"}`,
        tone: event.isError ? "error" : "tool",
      };
    case "approval_requested":
      return {
        label: `approval_requested · ${event.approval.tool}`,
        tone: "approval",
      };
    case "approval_resolved":
      return {
        label: `approval_resolved · ${event.approved ? "approved" : "denied"}`,
        tone: "approval",
      };
    case "changes":
      return {
        label: `changes · ${event.files.length} ${
          event.files.length === 1 ? "file" : "files"
        }`,
        tone: "neutral",
      };
    default:
      return {
        label: "unknown event",
        tone: "neutral",
      };
  }
}

export function resolveActiveTraceRunId(input: {
  events: readonly TimelineEnvelope[];
  runs: Readonly<Record<string, TimelineRun>>;
  activeRunId: string | null;
}): string | null {
  const running = Object.values(input.runs).find(
    (run) => run.status === "running",
  );
  if (running) return running.id;
  if (input.activeRunId) return input.activeRunId;

  let lastRunStart: string | null = null;
  for (const envelope of input.events) {
    if (envelope.event.type === "run_start") {
      lastRunStart = envelope.runId;
    }
  }
  return lastRunStart;
}

export function selectTraceEvents(
  events: readonly TimelineEnvelope[],
  runs: Readonly<Record<string, TimelineRun>>,
  filter: TraceRunFilter,
  activeRunId: string | null,
): TimelineEnvelope[] {
  if (filter === "all") return [...events];
  const runId = resolveActiveTraceRunId({ events, runs, activeRunId });
  if (!runId) return [];
  return events.filter((envelope) => envelope.runId === runId);
}

export function formatTraceTimestamp(emittedAt: number): string {
  return new Date(emittedAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function shortRunId(runId: string): string {
  return runId.length <= 8 ? runId : runId.slice(0, 8);
}

export function shortTurnId(turnId: string): string {
  const suffix = turnId.includes(":")
    ? turnId.slice(turnId.lastIndexOf(":") + 1)
    : turnId;
  if (suffix.length <= 12) return suffix;
  return `${suffix.slice(0, 11)}…`;
}

export type TraceDisplayItem =
  | { kind: "event"; envelope: TimelineEnvelope }
  | {
      kind: "muted-group";
      envelopes: TimelineEnvelope[];
      label: string;
    };

export function isMutedTraceEvent(envelope: TimelineEnvelope): boolean {
  return summarizeTimelineEvent(envelope).muted === true;
}

function mutedGroupLabel(envelopes: readonly TimelineEnvelope[]): string {
  const counts = new Map<string, number>();
  for (const envelope of envelopes) {
    const summary = summarizeTimelineEvent(envelope);
    const key = summary.label.split(" · ")[0] ?? summary.label;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => (count > 1 ? `${key} ×${count}` : key))
    .join(", ");
}

export function groupTraceDisplayItems(
  envelopes: readonly TimelineEnvelope[],
): TraceDisplayItem[] {
  const items: TraceDisplayItem[] = [];
  let mutedBuffer: TimelineEnvelope[] = [];

  const flushMuted = () => {
    if (mutedBuffer.length === 0) return;
    if (mutedBuffer.length === 1) {
      items.push({ kind: "event", envelope: mutedBuffer[0]! });
    } else {
      items.push({
        kind: "muted-group",
        envelopes: [...mutedBuffer],
        label: mutedGroupLabel(mutedBuffer),
      });
    }
    mutedBuffer = [];
  };

  for (const envelope of envelopes) {
    if (isMutedTraceEvent(envelope)) {
      mutedBuffer.push(envelope);
      continue;
    }
    flushMuted();
    items.push({ kind: "event", envelope });
  }
  flushMuted();
  return items;
}
