import {
  Check,
  ChevronRight,
  CircleSlash,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { AssistantTimelineItem } from "../../timeline/reducer";
import type { RunActivityModel } from "../../run-activity/types";
import { activityPhaseLabel } from "../../run-activity/project-run-activity";
import { Markdown } from "./Markdown";
import { ThinkingCard } from "./ThinkingCard";
import { ToolCard } from "./ToolCard";

export function RunActivityBlock(props: {
  activity: RunActivityModel;
  forceOpen?: boolean;
  displayText?: (item: AssistantTimelineItem) => string;
  isMessageComplete?: (item: AssistantTimelineItem) => boolean;
}) {
  const { activity } = props;
  const active = activity.viewMode === "active";
  const failed =
    activity.lifecycle === "error" || activity.lifecycle === "crashed";
  const readOnlyToolRun =
    activity.tools.length > 0 &&
    activity.counters.editedFiles.length === 0 &&
    activity.changes.length === 0;
  const [open, setOpen] = useState(Boolean(props.forceOpen || failed));

  useEffect(() => {
    if (!active && !failed && !props.forceOpen) setOpen(false);
  }, [active, failed, props.forceOpen]);

  if (!activity.hasActivity) return null;

  const StatusIcon = active
    ? LoaderCircle
    : failed
      ? X
      : activity.lifecycle === "cancelled"
        ? CircleSlash
        : Check;
  const displayText =
    props.displayText ?? ((item: AssistantTimelineItem) => item.text);
  const isMessageComplete =
    props.isMessageComplete ?? (() => true);
  const { additions, deletions } = activity.counters;
  const renderedSegments = activity.finalAssistant
    ? activity.workSegments
    : activity.segments;
  const associatedToolIds = new Set(
    renderedSegments.flatMap((segment) =>
      segment.tools.map((tool) => tool.id),
    ),
  );
  const orphanTools = activity.tools.filter(
    (tool) => !associatedToolIds.has(tool.id),
  );
  const showInlineTools =
    !open &&
    !active &&
    readOnlyToolRun &&
    activity.tools.length > 0;

  return (
    <section
      className={`run-activity ${activity.lifecycle} ${
        active ? "active" : "settled"
      } ${open ? "expanded" : ""}`}
      role="group"
      aria-label="Run activity"
    >
      <ThinkingCard content={activity.thinking} streaming={active} />

      {activity.summary ? (
        <button
          className="run-activity-summary"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight className="run-activity-chevron" />
          <StatusIcon className="run-activity-status" />
          <span className="run-activity-summary-text">{activity.summary}</span>
          {additions !== undefined || deletions !== undefined ? (
            <span
              className="run-activity-diff"
              aria-label={`${additions ?? 0} additions, ${
                deletions ?? 0
              } deletions`}
            >
              <span className="diff-add">+{additions ?? 0}</span>
              <span className="diff-delete">-{deletions ?? 0}</span>
            </span>
          ) : null}
        </button>
      ) : null}

      {active ? (
        <div
          className="run-activity-live-slot"
          aria-live="polite"
          aria-atomic="true"
        >
          {activity.currentAction ? (
            <span
              className="run-activity-atomic"
              title={`${activity.currentAction.verb} ${activity.currentAction.target}`}
            >
              {activity.currentAction.verb}{" "}
              <strong>{activity.currentAction.target}</strong>
            </span>
          ) : (
            <span className="run-activity-atomic">
              {activityPhaseLabel(activity.phase)}
            </span>
          )}
        </div>
      ) : failed ? (
        <div className="run-activity-failure">Execution failed</div>
      ) : null}

      {showInlineTools ? (
        <div className="run-activity-tools-inline">
          {activity.tools.map((tool) => (
            <ToolCard item={tool} key={tool.id} />
          ))}
        </div>
      ) : null}

      {open && (activity.summary || activity.tools.length > 0) ? (
        <div className="run-activity-details">
          {renderedSegments.map((segment) => {
            const text = displayText(segment.assistant);
            return (
              <div
                className="run-activity-segment"
                key={segment.turnId}
              >
                {text ? (
                  <div className="run-activity-segment-content">
                    <Markdown
                      streaming={!isMessageComplete(segment.assistant)}
                    >
                      {text}
                    </Markdown>
                  </div>
                ) : null}
                {segment.tools.map((tool) => (
                  <ToolCard item={tool} key={tool.id} />
                ))}
              </div>
            );
          })}
          {orphanTools.map((tool) => (
            <ToolCard item={tool} key={tool.id} />
          ))}
          {activity.changes.length > 0 ? (
            <div className="run-activity-changes">
              {activity.changes.flatMap((change) =>
                change.files.map((file) => (
                  <div
                    className="run-activity-change"
                    key={`${change.id}:${file.path}`}
                  >
                    <span>{file.path}</span>
                    <small>{file.status}</small>
                  </div>
                )),
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
