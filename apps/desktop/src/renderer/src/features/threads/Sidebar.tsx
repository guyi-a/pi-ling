import type { SessionSummary } from "@pi-ling/contracts";

export function Sidebar(props: {
  sessions: SessionSummary[];
  activeSessionId?: string;
  onNewSession: () => void;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <aside className="sidebar">
      <p className="section-label">SESSIONS</p>
      <button
        className="new-session"
        type="button"
        onClick={props.onNewSession}
      >
        <span>＋</span> New session
      </button>
      <div className="session-list">
        {props.sessions.map((session) => (
          <button
            className={`session-item ${
              session.id === props.activeSessionId ? "active" : ""
            }`}
            type="button"
            key={session.id}
            onClick={() => props.onSelect(session.id)}
          >
            <span>{session.title}</span>
            <small>
              {session.workspace.name} · {session.lifecycle}
            </small>
          </button>
        ))}
      </div>
    </aside>
  );
}
