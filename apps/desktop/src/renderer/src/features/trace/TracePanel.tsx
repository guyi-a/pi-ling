import { useEffect, useMemo, useRef, useState } from "react";

import type { TimelineEnvelope } from "@pi-ling/contracts";

import type { TimelineRun } from "../../timeline/reducer";
import { TraceEmptyState } from "./TraceEmptyState";
import { TraceEventRow } from "./TraceEventRow";
import { TraceMutedGroupRow } from "./TraceMutedGroupRow";
import {
  groupTraceDisplayItems,
  resolveActiveTraceRunId,
  selectTraceEvents,
  shortRunId,
  type TraceRunFilter,
} from "./trace-event-summary";

export function TracePanel(props: {
  sessionId: string | null;
  events: TimelineEnvelope[];
  runs: Record<string, TimelineRun>;
  activeRunId: string | null;
  active: boolean;
}) {
  const [filter, setFilter] = useState<TraceRunFilter>("active");
  const listRef = useRef<HTMLDivElement | null>(null);
  const filteredEvents = useMemo(
    () =>
      selectTraceEvents(
        props.events,
        props.runs,
        filter,
        props.activeRunId,
      ),
    [props.activeRunId, props.events, props.runs, filter],
  );
  const displayItems = useMemo(
    () => groupTraceDisplayItems(filteredEvents),
    [filteredEvents],
  );
  const activeRunId = resolveActiveTraceRunId({
    events: props.events,
    runs: props.runs,
    activeRunId: props.activeRunId,
  });
  const activeRun = activeRunId ? props.runs[activeRunId] : undefined;
  const isRunning = activeRun?.status === "running";

  useEffect(() => {
    if (!props.active || filter !== "active" || !isRunning) return;
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [filter, filteredEvents.length, isRunning, props.active]);

  if (!props.sessionId) {
    return <TraceEmptyState />;
  }

  return (
    <div
      className={`trace-panel ${props.active ? "is-active" : "is-hidden"}`}
      aria-hidden={!props.active}
    >
      <header className="trace-toolbar">
        <span
          className={`trace-status-dot ${isRunning ? "is-running" : ""}`}
          aria-hidden="true"
        />
        <label className="trace-filter">
          <span className="trace-filter-label">Run</span>
          <select
            className="trace-filter-select"
            value={filter}
            onChange={(event) =>
              setFilter(event.target.value as TraceRunFilter)
            }
            aria-label="Trace run filter"
          >
            <option value="active">
              {activeRunId
                ? `Current · ${shortRunId(activeRunId)}`
                : "Current run"}
            </option>
            <option value="all">All runs</option>
          </select>
        </label>
        <span className="trace-event-count">
          {filteredEvents.length} events
        </span>
      </header>
      <div ref={listRef} className="trace-event-list">
        {filteredEvents.length === 0 ? (
          <div className="trace-list-empty">
            {filter === "active" && !activeRunId
              ? "当前没有可展示的 run 事件。"
              : "没有匹配的事件。"}
          </div>
        ) : (
          displayItems.map((item) =>
            item.kind === "muted-group" ? (
              <TraceMutedGroupRow
                envelopes={item.envelopes}
                key={`muted-${item.envelopes[0]?.seq ?? 0}`}
                label={item.label}
              />
            ) : (
              <TraceEventRow envelope={item.envelope} key={item.envelope.seq} />
            ),
          )
        )}
      </div>
    </div>
  );
}
