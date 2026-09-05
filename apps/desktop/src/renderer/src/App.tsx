import type {
  AgentStatus,
  AgentUsage,
  ApprovalRequest,
  ChangedFile,
  FileDiff,
} from "@pi-ling/contracts";
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

interface ToolActivity {
  callId: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: "running" | "done" | "error";
  output?: string;
}

export function App() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [changes, setChanges] = useState<ChangedFile[]>([]);
  const [selectedDiff, setSelectedDiff] = useState<FileDiff | null>(null);
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
      } else if (event.type === "tool_start") {
        setTools((current) => [
          ...current.filter((tool) => tool.callId !== event.callId),
          {
            callId: event.callId,
            tool: event.tool,
            arguments: event.arguments,
            status: "running",
          },
        ]);
      } else if (event.type === "tool_end") {
        setTools((current) =>
          current.map((tool) =>
            tool.callId === event.callId
              ? {
                  ...tool,
                  status: event.isError ? "error" : "done",
                  output: event.output,
                }
              : tool,
          ),
        );
      } else if (event.type === "approval_requested") {
        setApprovals((current) => [...current, event.approval]);
      } else if (event.type === "approval_resolved") {
        setApprovals((current) =>
          current.filter((approval) => approval.callId !== event.callId),
        );
      } else if (event.type === "changes") {
        setChanges(event.files);
      } else if (event.type === "agent_end") {
        setActiveRequestId((current) =>
          current === requestId ? null : current,
        );
      }
    });
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, tools, approvals]);

  async function chooseWorkspace() {
    const workspace = await window.piLing.selectWorkspace();
    if (!workspace) {
      return;
    }
    setStatus((current) =>
      current ? { ...current, workspace } : current,
    );
    setMessages([]);
    setTools([]);
    setApprovals([]);
    setChanges([]);
    setSelectedDiff(null);
    setActiveRequestId(null);
  }

  async function sendPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || activeRequestId || !status?.workspace) {
      return;
    }

    const requestId = crypto.randomUUID();
    setPrompt("");
    setActiveRequestId(requestId);
    setMessages((current) => [
      ...current,
      { id: `${requestId}-user`, role: "user", text: value },
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

  async function decide(approval: ApprovalRequest, approved: boolean) {
    const resolved = await window.piLing.resolveApproval({
      callId: approval.callId,
      approved,
      effectDigest: approval.effectDigest,
      ...(!approved ? { reason: "Denied by user" } : {}),
    });
    if (resolved) {
      setApprovals((current) =>
        current.filter((item) => item.callId !== approval.callId),
      );
    }
  }

  async function showDiff(file: ChangedFile) {
    setSelectedDiff((await window.piLing.getDiff(file.path)) ?? null);
  }

  async function newSession() {
    await window.piLing.resetAgent();
    setActiveRequestId(null);
    setMessages([]);
    setTools([]);
    setApprovals([]);
    setChanges([]);
    setSelectedDiff(null);
    setPrompt("");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">π</span>
          <span>pi-ling</span>
        </div>
        <button className="workspace-button" type="button" onClick={chooseWorkspace}>
          {status?.workspace?.name ?? "Open workspace"}
        </button>
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

            {tools.map((tool) => (
              <div className={`tool-card ${tool.status}`} key={tool.callId}>
                <div>
                  <strong>{tool.tool}</strong>
                  <span>{tool.status}</span>
                </div>
                <code>{JSON.stringify(tool.arguments)}</code>
                {tool.output ? <pre>{tool.output}</pre> : null}
              </div>
            ))}

            {approvals.map((approval) => (
              <div className="approval-card" key={approval.callId}>
                <strong>Approval required · {approval.tool}</strong>
                <p>{approval.reason}</p>
                <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>
                <div className="approval-actions">
                  <button type="button" onClick={() => decide(approval, false)}>
                    Deny
                  </button>
                  <button
                    className="allow"
                    type="button"
                    onClick={() => decide(approval, true)}
                  >
                    Allow once
                  </button>
                </div>
              </div>
            ))}
            <div ref={messageEndRef} />
          </div>

          <form className="composer" onSubmit={sendPrompt}>
            <div className="model-status">
              {!status?.configured
                ? "DEEPSEEK_API_KEY missing"
                : status.workspace
                  ? `${status.provider}/${status.model} · ${status.workspace.root}`
                  : "Select a workspace to start"}
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
                placeholder="Ask pi-ling to inspect or change the workspace"
                rows={2}
                disabled={!status?.workspace}
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
                  disabled={!prompt.trim() || !status?.workspace}
                >
                  Send
                </button>
              )}
            </div>
          </form>
        </section>

        <aside className="diff-panel">
          <p className="section-label">CHANGES</p>
          {changes.length === 0 ? (
            <div className="empty-changes">No changes</div>
          ) : (
            changes.map((file) => (
              <button
                className="change-file"
                type="button"
                key={file.path}
                onClick={() => showDiff(file)}
              >
                <span>{file.path}</span>
                <small>{file.status}</small>
              </button>
            ))
          )}
          {selectedDiff ? (
            <pre className="diff-content">{selectedDiff.patch}</pre>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
