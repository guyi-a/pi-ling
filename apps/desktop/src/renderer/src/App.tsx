import type {
  AgentStatus,
  SessionActivation,
  SessionSummary,
  TimelineEnvelope,
} from "@pi-ling/contracts";
import { FolderOpen } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

import { ChatView } from "./features/chat/ChatView";
import { Sidebar } from "./features/threads/Sidebar";
import type { ApprovalTimelineItem } from "./timeline/reducer";
import {
  createTimelineState,
  timelineReducer,
} from "./timeline/reducer";

export function App() {
  const [timeline, dispatch] = useReducer(
    timelineReducer,
    undefined,
    createTimelineState,
  );
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const queueRef = useRef<TimelineEnvelope[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      const queued = queueRef.current;
      queueRef.current = [];
      for (const envelope of queued) {
        dispatch({ type: "event", envelope });
      }
    };
    const unsubscribe = window.piLing.onTimelineEvent((envelope) => {
      queueRef.current.push(envelope);
      timerRef.current ??= setTimeout(flush, 16);
      if (
        envelope.event.type === "run_end" ||
        envelope.event.type === "approval_requested" ||
        envelope.event.type === "approval_resolved"
      ) {
        void window.piLing.listSessions().then(setSessions);
      }
    });

    void window.piLing.getAgentStatus().then(setStatus);
    void window.piLing.listSessions().then(setSessions);
    void window.piLing
      .getTimelineSnapshot()
      .then((snapshot) => dispatch({ type: "snapshot", snapshot }));

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      pendingRunId &&
      timeline.runs[pendingRunId] &&
      timeline.runs[pendingRunId].status !== "running"
    ) {
      setPendingRunId(null);
    }
  }, [pendingRunId, timeline.runs]);

  const activeRunId =
    pendingRunId ??
    Object.values(timeline.runs).find((run) => run.status === "running")?.id ??
    null;

  function applyActivation(activation: SessionActivation) {
    setStatus(activation.status);
    setPendingRunId(null);
    dispatch({ type: "snapshot", snapshot: activation.snapshot });
    void window.piLing.listSessions().then(setSessions);
  }

  async function chooseWorkspace() {
    const activation = await window.piLing.selectWorkspace();
    if (!activation) {
      return;
    }
    dispatch({ type: "clear" });
    applyActivation(activation);
  }

  async function sendPrompt(prompt: string) {
    const runId = crypto.randomUUID();
    setPendingRunId(runId);
    try {
      await window.piLing.sendPrompt({ requestId: runId, prompt });
    } catch (error) {
      setPendingRunId(null);
      throw error;
    }
  }

  async function decide(
    item: ApprovalTimelineItem,
    approved: boolean,
  ) {
    await window.piLing.resolveApproval({
      callId: item.approval.callId,
      approved,
      effectDigest: item.approval.effectDigest,
      ...(!approved ? { reason: "Denied by user" } : {}),
    });
  }

  async function newSession() {
    if (!status?.workspace) {
      await chooseWorkspace();
      return;
    }
    applyActivation(
      await window.piLing.createSession({
        workspaceRoot: status.workspace.root,
      }),
    );
  }

  async function switchSession(sessionId: string) {
    if (sessionId === status?.sessionId) {
      return;
    }
    applyActivation(await window.piLing.switchSession(sessionId));
  }

  const modelLabel = !status?.configured
    ? "缺少 DEEPSEEK_API_KEY"
    : status.workspace
      ? `${status.provider}/${status.model} · ${status.workspace.root}`
      : "请选择工作区";

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">π</span>
          <span>pi-ling</span>
        </div>
        <button
          className="workspace-button"
          type="button"
          onClick={chooseWorkspace}
        >
          <FolderOpen />
          {status?.workspace?.name ?? "打开工作区"}
        </button>
      </header>

      <section className="workspace">
        <Sidebar
          sessions={sessions}
          {...(status?.sessionId
            ? { activeSessionId: status.sessionId }
            : {})}
          onNewSession={() => void newSession()}
          onSelect={(sessionId) => void switchSession(sessionId)}
        />
        <ChatView
          items={timeline.items}
          modelLabel={modelLabel}
          workspaceReady={Boolean(status?.workspace)}
          activeRunId={activeRunId}
          onSend={sendPrompt}
          onCancel={(runId) => {
            void window.piLing.cancelPrompt(runId);
          }}
          onApproval={decide}
        />
      </section>
    </main>
  );
}
