import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { TimelineEnvelope } from "@pi-ling/contracts";

import {
  formatTraceTimestamp,
  shortRunId,
  summarizeTimelineEvent,
} from "./trace-event-summary";

export function TraceEventRow(props: { envelope: TimelineEnvelope }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeTimelineEvent(props.envelope);

  return (
    <article
      className={`trace-event-row tone-${summary.tone}${
        summary.muted ? " is-muted" : ""
      }${open ? " is-open" : ""}`}
    >
      <button
        type="button"
        className="trace-event-summary"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight className="trace-event-chevron" aria-hidden="true" />
        <span className="trace-event-seq">#{props.envelope.seq}</span>
        <time className="trace-event-time">
          {formatTraceTimestamp(props.envelope.emittedAt)}
        </time>
        <span className="trace-event-run" title={props.envelope.runId}>
          {shortRunId(props.envelope.runId)}
        </span>
        <span className="trace-event-label">{summary.label}</span>
      </button>
      {open ? (
        <pre className="trace-event-detail">
          {JSON.stringify(props.envelope.event, null, 2)}
        </pre>
      ) : null}
    </article>
  );
}
