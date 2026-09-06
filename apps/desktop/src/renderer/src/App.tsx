import type {
  AgentStatus,
  ApprovalMode,
  RuntimeKind,
  SessionActivation,
  SessionSummary,
  TimelineEnvelope,
} from "@pi-ling/contracts";
import { useEffect, useReducer, useRef, useState } from "react";

import { ChatView } from "./features/chat/ChatView";
import { Sidebar } from "./features/threads/Sidebar";
import type { ApprovalTimelineItem } from "./timeline/reducer";
import {
  createTimelineState,
  timelineReducer,
} from "./timeline/reducer";
import {
  createUiFixture,
  type UiFixtureName,
} from "./ui-fixtures";

const fixtureName = new URLSearchParams(window.location.search).get("fixture");
const fixture =
  fixtureName &&
  ["empty", "markdown", "tool", "approval", "long"].includes(fixtureName)
    ? createUiFixture(fixtureName as UiFixtureName)
    : undefined;

export function App() {
  const [timeline, dispatch] = useReducer(
    timelineReducer,
    undefined,
    () => fixture?.timeline ?? createTimelineState(),
  );
  const [status, setStatus] = useState<AgentStatus | null>(
    fixture?.status ?? null,
  );
  const [sessions, setSessions] = useState<SessionSummary[]>(
    fixture?.sessions ?? [],
  );
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [showDshNotice, setShowDshNotice] = useState(false);
  const queueRef = useRef<TimelineEnvelope[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (fixture) return;
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

  async function chooseWorkspace(
    runtimeKind: RuntimeKind = status?.runtimeKind ?? "native",
  ) {
    const activation = await window.piLing.selectWorkspace(runtimeKind);
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

  async function newSession(workspaceRoot?: string) {
    const root = workspaceRoot ?? status?.workspace?.root;
    if (!root) {
      await chooseWorkspace();
      return;
    }
    applyActivation(
      await window.piLing.createSession({
        workspaceRoot: root,
        runtimeKind: status?.runtimeKind ?? "native",
      }),
    );
  }

  async function switchSession(sessionId: string) {
    if (sessionId === status?.sessionId) {
      return;
    }
    applyActivation(await window.piLing.switchSession(sessionId));
  }

  async function changeApprovalMode(mode: ApprovalMode) {
    const updated = await window.piLing.setApprovalMode(mode);
    setStatus((current) =>
      current ? { ...current, approvalMode: mode } : current,
    );
    setSessions((current) =>
      current.map((session) =>
        session.id === updated.id ? updated : session,
      ),
    );
  }

  async function activateRuntime(runtimeKind: RuntimeKind) {
    if (runtimeKind === status?.runtimeKind) return;
    if (
      runtimeKind === "dsh" &&
      localStorage.getItem("pi-ling.dsh-safety-accepted") !== "1"
    ) {
      setShowDshNotice(true);
      return;
    }
    if (!status?.workspace) {
      await chooseWorkspace(runtimeKind);
      return;
    }
    applyActivation(await window.piLing.switchRuntime(runtimeKind));
  }

  const modelLabel = !status?.configured
    ? "缺少 DEEPSEEK_API_KEY"
    : status.workspace
      ? `${status.provider}/${status.model}`
      : "请选择工作区";
  const activeSessionTitle = sessions.find(
    (session) => session.id === status?.sessionId,
  )?.title;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="title-context">
          <div className="brand">
            <span className="brand-mark">π</span>
            <span>pi-ling</span>
          </div>
          {activeSessionTitle ? (
            <>
              <span className="title-divider" />
              <span className="workspace-context">
                {activeSessionTitle}
              </span>
            </>
          ) : null}
        </div>
      </header>

      <section className="workspace">
        <Sidebar
          sessions={sessions}
          {...(status?.sessionId
            ? { activeSessionId: status.sessionId }
            : {})}
          onNewSession={(root) => void newSession(root)}
          onAddWorkspace={() => void chooseWorkspace()}
          onSelect={(sessionId) => void switchSession(sessionId)}
        />
        <ChatView
          items={timeline.items}
          modelLabel={modelLabel}
          workspaceReady={Boolean(status?.workspace)}
          activeRunId={activeRunId}
          approvalMode={status?.approvalMode ?? "manual"}
          runtimeKind={status?.runtimeKind ?? "native"}
          availableRuntimes={status?.availableRuntimes ?? ["native"]}
          onSend={sendPrompt}
          onCancel={(runId) => {
            void window.piLing.cancelPrompt(runId);
          }}
          onApproval={decide}
          onApprovalModeChange={changeApprovalMode}
          onRuntimeChange={(runtime) => {
            void activateRuntime(runtime);
          }}
        />
      </section>
      {showDshNotice ? (
        <div className="safety-backdrop" role="presentation">
          <section
            className="safety-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dsh-safety-title"
          >
            <span className="experimental-label">Experimental Runtime</span>
            <h2 id="dsh-safety-title">启用 DeepSeek Harness</h2>
            <p>
              DSH 目前是 developer preview，尚未经过安全审计。它可以执行模型生成的命令并访问工作区文件，审批和沙箱不能保证完全隔离。
            </p>
            <p>仅在有备份、可恢复的工作区中使用。</p>
            <div className="safety-actions">
              <button type="button" onClick={() => setShowDshNotice(false)}>
                取消
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  localStorage.setItem("pi-ling.dsh-safety-accepted", "1");
                  setShowDshNotice(false);
                  void activateRuntime("dsh");
                }}
              >
                我了解风险，继续
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
