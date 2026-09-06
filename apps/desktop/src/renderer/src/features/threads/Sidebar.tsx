import type { SessionSummary } from "@pi-ling/contracts";
import { FolderOpen, FolderPlus, Plus } from "lucide-react";
import { memo, useMemo } from "react";

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
  onNewSession: (workspaceRoot?: string) => void;
  onAddWorkspace: () => void;
  onSelect: (sessionId: string) => void;
}) {
  const projects = useMemo(() => {
    const grouped = new Map<
      string,
      { name: string; sessions: SessionSummary[] }
    >();
    for (const session of props.sessions) {
      const project = grouped.get(session.workspace.root) ?? {
        name: session.workspace.name,
        sessions: [],
      };
      project.sessions.push(session);
      grouped.set(session.workspace.root, project);
    }
    return [...grouped.entries()];
  }, [props.sessions]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <p className="section-label">项目与会话</p>
      </div>
      <button
        className="new-session"
        type="button"
        onClick={() => props.onNewSession()}
      >
        <Plus />
        新建会话
      </button>
      <div className="session-list">
        {projects.length === 0 ? (
          <div className="sidebar-empty">添加一个工作区开始对话</div>
        ) : (
          projects.map(([root, project]) => (
            <section className="project-group" key={root}>
              <div className="project-header" title={root}>
                <FolderOpen />
                <span>{project.name}</span>
                <button
                  type="button"
                  aria-label={`在 ${project.name} 中新建会话`}
                  onClick={() => props.onNewSession(root)}
                >
                  <Plus />
                </button>
              </div>
              {project.sessions.map((session) => (
                <button
                  className={`session-item ${
                    session.id === props.activeSessionId ? "active" : ""
                  }`}
                  type="button"
                  key={session.id}
                  onClick={() => props.onSelect(session.id)}
                  title={session.title}
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
                    {session.runtimeKind === "dsh" ? "DSH · " : ""}
                    {relativeTime(session.updatedAt)}
                  </time>
                </button>
              ))}
            </section>
          ))
        )}
      </div>
      <button
        className="add-workspace"
        type="button"
        onClick={props.onAddWorkspace}
      >
        <FolderPlus />
        添加工作区
      </button>
    </aside>
  );
});
