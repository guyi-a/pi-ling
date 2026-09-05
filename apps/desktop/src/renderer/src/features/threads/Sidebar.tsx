import type { SessionSummary } from "@pi-ling/contracts";
import { FolderOpen, Plus } from "lucide-react";
import { memo } from "react";

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(elapsed / 3_600_000);
  const days = Math.floor(elapsed / 86_400_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

export const Sidebar = memo(function Sidebar(props: {
  sessions: SessionSummary[];
  activeSessionId?: string;
  onNewSession: () => void;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <p className="section-label">会话</p>
      </div>
      <button
        className="new-session"
        type="button"
        onClick={props.onNewSession}
      >
        <Plus />
        新建会话
      </button>
      <div className="session-list">
        {props.sessions.length === 0 ? (
          <div className="sidebar-empty">选择工作区后开始对话</div>
        ) : (
          props.sessions.map((session) => (
            <button
              className={`session-item ${
                session.id === props.activeSessionId ? "active" : ""
              }`}
              type="button"
              key={session.id}
              onClick={() => props.onSelect(session.id)}
              title={`${session.title}\n${session.workspace.root}`}
            >
              <span
                className={`session-status ${session.lifecycle}`}
                title={session.lifecycle}
              />
              <span className="session-title">{session.title}</span>
              <time
                className="session-time"
                dateTime={new Date(session.updatedAt).toISOString()}
              >
                {relativeTime(session.updatedAt)}
              </time>
              <span className="session-workspace">
                <FolderOpen />
                {session.workspace.name}
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
});
