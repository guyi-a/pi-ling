export function Sidebar(props: {
  onNewSession: () => void;
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
      <div className="session-item active">Debug session</div>
    </aside>
  );
}
