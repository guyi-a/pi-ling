import type { RuntimeKind, SessionSummary } from "@pi-ling/contracts";

import { Archive, Pin, RotateCcw, TriangleAlert } from "lucide-react";



function relativeTime(timestamp: number): string {

  const elapsed = Math.max(0, Date.now() - timestamp);

  const minutes = Math.floor(elapsed / 60_000);

  const hours = Math.floor(elapsed / 3_600_000);

  const days = Math.floor(elapsed / 86_400_000);

  if (minutes < 1) return "now";

  if (minutes < 60) return `${minutes}m`;

  if (hours < 24) return `${hours}h`;

  return `${days}d`;

}



export function SessionRow(props: {

  session: SessionSummary;

  active: boolean;

  availableRuntimes: RuntimeKind[];

  archived: boolean;

  onSelect: () => void;

  onPin: (pinned: boolean) => void;

  onArchive: () => void;

  onRestore: () => void;

}) {

  const unavailable =

    (props.session.runtimeKind === "dsh" &&

      !props.availableRuntimes.includes("dsh")) ||

    (props.session.runtimeKind === "codex" &&

      !props.availableRuntimes.includes("codex"));

  const runtimeLabel =

    props.session.runtimeKind === "dsh"

      ? "DeepSeek Harness"

      : props.session.runtimeKind === "codex"

        ? "DeepSeek Codex"

        : "Native";

  const stateLabel = unavailable

    ? "DSH Runtime is not enabled"

    : `${runtimeLabel} · ${props.session.lifecycle}`;



  return (

    <div

      className={`session-item ${props.active ? "active" : ""} ${

        unavailable ? "unavailable" : ""

      } ${props.session.pinnedAt ? "pinned" : ""}`}

      title={stateLabel}

    >

      <button

        className="session-select"

        type="button"

        aria-current={props.active ? "page" : undefined}

        disabled={unavailable || props.archived}

        onClick={props.onSelect}

      >

        {unavailable ? (

          <TriangleAlert className="session-state-icon unavailable" />

        ) : props.session.lifecycle === "crashed" ? (

          <TriangleAlert className="session-state-icon crashed" />

        ) : props.session.pinnedAt ? (

          <Pin className="session-state-icon pinned" />

        ) : props.session.lifecycle !== "idle" ? (

          <span className={`session-status ${props.session.lifecycle}`} />

        ) : (

          <span className="session-state-spacer" />

        )}

        <span className="session-title">{props.session.title}</span>

        <time

          className="session-time"

          dateTime={new Date(props.session.updatedAt).toISOString()}

        >

          {relativeTime(props.session.updatedAt)}

        </time>

      </button>

      <div className="session-actions">

        {props.archived ? (

          <button

            type="button"

            title="Restore chat"

            aria-label={`Restore ${props.session.title}`}

            onClick={props.onRestore}

          >

            <RotateCcw />

          </button>

        ) : (

          <>

            <button

              className={props.session.pinnedAt ? "selected" : ""}

              type="button"

              title={props.session.pinnedAt ? "Unpin chat" : "Pin chat"}

              aria-label={`${

                props.session.pinnedAt ? "Unpin" : "Pin"

              } ${props.session.title}`}

              aria-pressed={Boolean(props.session.pinnedAt)}

              onClick={() => props.onPin(!props.session.pinnedAt)}

            >

              <Pin />

            </button>

            <button

              type="button"

              title="Archive chat"

              aria-label={`Archive ${props.session.title}`}

              onClick={props.onArchive}

            >

              <Archive />

            </button>

          </>

        )}

      </div>

    </div>

  );

}

