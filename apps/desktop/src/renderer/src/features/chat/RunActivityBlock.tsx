import { ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { AssistantTimelineItem } from "../../timeline/reducer";
import type { RunActivityModel } from "../../run-activity/types";
import { activityPhaseLabel } from "../../run-activity/project-run-activity";
import {
  runTodoSummary,
  todoStatusGlyph,
} from "../../run-activity/project-run-todos";
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
  const [open, setOpen] = useState(Boolean(props.forceOpen));
  const [todosOpen, setTodosOpen] = useState(false);

  useEffect(() => {
    if (!active && !props.forceOpen) {
      setOpen(false);
    }
  }, [active, props.forceOpen]);

  if (!activity.hasActivity) return null;

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

      {activity.todos ? (
        <>
          <button
            className="run-activity-todos-summary"
            type="button"
            aria-expanded={todosOpen}
            onClick={() => setTodosOpen((current) => !current)}
          >
            <ChevronRight className="run-activity-chevron" />
            <span className="run-activity-todos-summary-text">
              {runTodoSummary(activity.todos)}
            </span>
          </button>
          {todosOpen ? (
            <ul className="run-activity-todos-list">
              {activity.todos.todos.map((todo) => (
                <li
                  className={`run-activity-todo run-activity-todo-${todo.status}`}
                  key={todo.id}
                >
                  <span className="run-activity-todo-glyph" aria-hidden="true">
                    {todoStatusGlyph(todo.status)}
                  </span>
                  <span>{todo.content}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {active ? (
        <div
          className="run-activity-live-slot"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="run-activity-leading-spacer" aria-hidden="true" />
          {activity.summary ? (
            <span className="run-activity-status-spacer" aria-hidden="true" />
          ) : (
            <LoaderCircle className="run-activity-status" />
          )}
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
