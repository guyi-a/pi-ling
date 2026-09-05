import type { AppInfo } from "@pi-ling/contracts";
import { useEffect, useState } from "react";

const phases = [
  ["01", "Electron framework", "ready"],
  ["02", "pi-ai model adapter", "next"],
  ["03", "Pi coding runtime", "planned"],
] as const;

export function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.piLing.getAppInfo().then(setAppInfo).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "IPC connection failed");
    });
  }, []);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">π</span>
          <span>pi-ling</span>
        </div>
        <span className="runtime-pill">Runtime · not connected</span>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <p className="eyebrow">WORKSPACE</p>
          <button className="new-session" type="button">
            <span>＋</span> New session
          </button>
          <div className="empty-list">No sessions yet</div>
          <div className="system-status">
            <span className={error ? "status-dot error" : "status-dot"} />
            {error ? "Main process unavailable" : "Electron supervisor online"}
          </div>
        </aside>

        <section className="content">
          <div className="hero">
            <div className="hero-icon">π</div>
            <p className="eyebrow">CODING AGENT WORKSTATION</p>
            <h1>Framework is running.</h1>
            <p className="lead">
              The secure Electron shell is ready. Model and agent runtimes will
              be connected behind typed IPC boundaries.
            </p>

            <div className="phase-list">
              {phases.map(([number, label, state]) => (
                <div className={`phase ${state}`} key={number}>
                  <span className="phase-number">{number}</span>
                  <span>{label}</span>
                  <span className="phase-state">{state}</span>
                </div>
              ))}
            </div>

            <div className="app-info">
              {error
                ? error
                : appInfo
                  ? `${appInfo.name} v${appInfo.version} · ${appInfo.platform}`
                  : "Connecting to Electron main process…"}
            </div>
          </div>

          <div className="composer">
            <span>Model adapter will be added in the next step</span>
            <button type="button" disabled aria-label="Send prompt">
              ↑
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
