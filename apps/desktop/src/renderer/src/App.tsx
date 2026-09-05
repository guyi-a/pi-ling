import type { AgentStatus, AgentUsage } from "@pi-ling/contracts";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  error?: string;
  usage?: AgentUsage;
  pending?: boolean;
}

export function App() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.piLing.getAgentStatus().then(setStatus);
    return window.piLing.onAgentEvent(({ requestId, event }) => {
      if (event.type === "text_delta") {
        setMessages((current) =>
          current.map((message) =>
            message.id === requestId
              ? { ...message, text: message.text + event.delta }
              : message,
          ),
        );
      } else if (event.type === "thinking_delta") {
        setMessages((current) =>
          current.map((message) =>
            message.id === requestId
              ? {
                  ...message,
                  thinking: (message.thinking ?? "") + event.delta,
                }
              : message,
          ),
        );
      } else if (event.type === "assistant_end") {
        setMessages((current) =>
          current.map((message) =>
            message.id === requestId
              ? {
                  ...message,
                  pending: false,
                  usage: event.usage,
                  ...(event.error ? { error: event.error } : {}),
                }
              : message,
          ),
        );
      } else if (event.type === "agent_end") {
          setActiveRequestId((current) =>
          current === requestId ? null : current,
          );
      }
    });
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || activeRequestId) {
      return;
    }

    const requestId = crypto.randomUUID();
    setPrompt("");
    setActiveRequestId(requestId);
    setMessages((current) => [
      ...current,
      {
        id: `${requestId}-user`,
        role: "user",
        text: value,
      },
      {
        id: requestId,
        role: "assistant",
        text: "",
        pending: true,
      },
    ]);
    try {
      await window.piLing.sendPrompt({ requestId, prompt: value });
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === requestId
            ? {
                ...message,
                pending: false,
                error: error instanceof Error ? error.message : String(error),
              }
            : message,
        ),
      );
      setActiveRequestId(null);
    }
  }

  async function newSession() {
    await window.piLing.resetAgent();
    setActiveRequestId(null);
    setMessages([]);
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
          <div className="message-list" aria-live="polite">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-role">
                  {message.role === "user" ? "You" : "pi-ling"}
                </div>
                {message.thinking ? (
                  <details className="thinking">
                    <summary>Thinking</summary>
                    <div>{message.thinking}</div>
                  </details>
                ) : null}
                <div className="message-text">
                  {message.text ||
                    (message.pending ? "Thinking…" : "No text response")}
                </div>
                {message.error ? (
                  <div className="message-error">{message.error}</div>
                ) : null}
                {message.usage ? (
                  <div className="message-usage">
                    {message.usage.input} in · {message.usage.output} out ·{" "}
                    {message.usage.totalTokens} total
                  </div>
                ) : null}
              </article>
            ))}
            <div ref={messageEndRef} />
          </div>

          <form className="composer" onSubmit={sendPrompt}>
            <div className="model-status">
              {status
                ? `${status.provider}/${status.model}${
                    status.configured ? "" : " · DEEPSEEK_API_KEY missing"
                  }`
                : "Starting agent…"}
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
                placeholder="Message pi-ling"
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
