export function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">π</span>
          <span>pi-ling</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <p className="section-label">SESSIONS</p>
          <button className="new-session" type="button">
            <span>＋</span> New session
          </button>
          <div className="empty-list">No sessions yet</div>
        </aside>

        <section className="content" aria-label="Session workspace" />
      </section>
    </main>
  );
}
