import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { TimelineEnvelope } from "@pi-ling/contracts";

import {
  formatTraceTimestamp,
  shortRunId,
  summarizeTimelineEvent,
} from "./trace-event-summary";

export function TraceMutedGroupRow(props: {
  envelopes: TimelineEnvelope[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const first = props.envelopes[0];
  const last = props.envelopes.at(-1);

  if (!first || !last) return null;

  return (
    <article
      className={`trace-event-row trace-muted-group tone-neutral${
        open ? " is-open" : ""
      }`}
    >
      <button
        type="button"
        className="trace-event-summary"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight className="trace-event-chevron" aria-hidden="true" />
        <span className="trace-event-seq">
          #{first.seq}–#{last.seq}
        </span>
        <time className="trace-event-time">
          {formatTraceTimestamp(first.emittedAt)}
        </time>
        <span className="trace-event-run" title={first.runId}>
          {shortRunId(first.runId)}
        </span>
        <span className="trace-event-label">
          {props.envelopes.length} muted · {props.label}
        </span>
      </button>
      {open ? (
        <ul className="trace-muted-group-items">
          {props.envelopes.map((envelope) => {
            const summary = summarizeTimelineEvent(envelope);
            return (
              <li key={envelope.seq} className="trace-muted-group-item">
                <span className="trace-event-seq">#{envelope.seq}</span>
                <time className="trace-event-time">
                  {formatTraceTimestamp(envelope.emittedAt)}
                </time>
                <span className="trace-event-label">{summary.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}
