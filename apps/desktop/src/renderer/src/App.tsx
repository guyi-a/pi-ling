import type { ModelStatus, RawModelEvent } from "@pi-ling/contracts";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

export function App() {
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState<RawModelEvent[]>([]);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.piLing.getModelStatus().then(setStatus);
    return window.piLing.onModelEvent((event) => {
      setEvents((current) => [...current, event]);
      try {
        const parsed = JSON.parse(event.json) as { type?: unknown };
        if (
          parsed.type === "done" ||
          parsed.type === "error" ||
          parsed.type === "ipc_error"
        ) {
          setActiveRequestId((current) =>
            current === event.requestId ? null : current,
          );
        }
      } catch {
        // Keep malformed payloads visible in the raw event log.
      }
    });
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || activeRequestId) {
      return;
    }

    const requestId = crypto.randomUUID();
    setPrompt("");
    setActiveRequestId(requestId);
    try {
      await window.piLing.sendPrompt({ requestId, prompt: value });
    } catch (error) {
      setEvents((current) => [
        ...current,
        {
          requestId,
          json: JSON.stringify(
            {
              type: "ipc_error",
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        },
      ]);
      setActiveRequestId(null);
    }
  }

  async function newSession() {
    if (activeRequestId) {
      await window.piLing.cancelPrompt(activeRequestId);
    }
    setActiveRequestId(null);
    setEvents([]);
    setPrompt("");
  }

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
          <button className="new-session" type="button" onClick={newSession}>
            <span>＋</span> New session
          </button>
          <div className="session-item active">Debug session</div>
        </aside>

        <section className="content" aria-label="Session workspace">
          <div className="event-log" aria-live="polite">
            {events.map((event, index) => (
              <pre className="raw-event" key={`${event.requestId}-${index}`}>
                {event.json}
              </pre>
            ))}
            <div ref={logEndRef} />
          </div>

          <form className="composer" onSubmit={sendPrompt}>
            <div className="model-status">
              {status
                ? `${status.provider}/${status.model}${
                    status.configured ? "" : " · DEEPSEEK_API_KEY missing"
                  }`
                : "Checking model configuration…"}
            </div>
            <div className="composer-row">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Send a prompt to pi-ai"
                rows={2}
              />
              {activeRequestId ? (
                <button
                  className="send-button"
                  type="button"
                  onClick={() => window.piLing.cancelPrompt(activeRequestId)}
                >
                  Stop
                </button>
              ) : (
                <button
                  className="send-button"
                  type="submit"
                  disabled={!prompt.trim()}
                >
                  Send
                </button>
              )}
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
