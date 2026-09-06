import type {
  RuntimeKind,
  SessionSummary,
  WorkspaceListEntry,
} from "@pi-ling/contracts";
import { ChevronDown, Folder, Plus } from "lucide-react";

import { SessionRow } from "./SessionRow";

export function ProjectGroup(props: {
  workspace: WorkspaceListEntry;
  sessions: SessionSummary[];
  expanded: boolean;
  archived: boolean;
  activeSessionId?: string;
  availableRuntimes: RuntimeKind[];
  onToggle: () => void;
  onNewSession: () => void;
  onSelect: (sessionId: string) => void;
  onPin: (sessionId: string, pinned: boolean) => void;
  onArchive: (sessionId: string) => void;
  onRestore: (sessionId: string) => void;
}) {
  const sessionListId = `workspace-${props.workspace.id}-sessions`;

  return (
    <section className="project-group">
      <div className="project-header" title={props.workspace.root}>
        <button
          className="project-toggle"
          type="button"
          aria-expanded={props.expanded}
          aria-controls={sessionListId}
          onClick={props.onToggle}
        >
          {props.expanded ? <ChevronDown /> : <Folder />}
          <span>{props.workspace.name}</span>
        </button>
        {!props.archived ? (
          <button
            className="project-new-session"
            type="button"
            title={`New agent in ${props.workspace.name}`}
            aria-label={`New agent in ${props.workspace.name}`}
            onClick={props.onNewSession}
          >
            <Plus />
          </button>
        ) : null}
      </div>
      {props.expanded ? (
        <div className="project-sessions" id={sessionListId}>
          {props.sessions.length > 0 ? (
            props.sessions.map((session) => (
              <SessionRow
                session={session}
                active={session.id === props.activeSessionId}
                availableRuntimes={props.availableRuntimes}
                archived={props.archived}
                key={session.id}
                onSelect={() => props.onSelect(session.id)}
                onPin={(pinned) => props.onPin(session.id, pinned)}
                onArchive={() => props.onArchive(session.id)}
                onRestore={() => props.onRestore(session.id)}
              />
            ))
          ) : (
            <span className="project-empty">No chats yet</span>
          )}
        </div>
      ) : null}
    </section>
  );
}
