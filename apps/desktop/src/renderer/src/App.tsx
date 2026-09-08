import type {
  AgentStatus,
  ApprovalMode,
  ChangedFile,
  RuntimeKind,
  SessionActivation,
  StreamFrameEnvelope,
  TimelineEnvelope,
  WorkspaceListEntry,
} from "@pi-ling/contracts";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { ChatView } from "./features/chat/ChatView";
import {
  AgentPaneToolbar,
  AppTitleBar,
  WorkbenchPanel,
} from "./features/shell/WorkbenchChrome";
import { SettingsView } from "./features/settings/SettingsView";
import { Sidebar } from "./features/threads/Sidebar";
import {
  DEFAULT_CHANGES_SOURCE,
  type ChangesSourceId,
} from "./features/details/changes-source";
import { lastAgentTurnChanges } from "./run-activity/run-changes";
import { applyTheme, readInitialTheme } from "./theme";
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
  [
    "empty",
    "markdown",
    "tool",
    "approval",
    "long",
    "sidebar",
    "run-active",
    "run-completed",
    "run-failed",
    "run-multi-runtime",
  ].includes(fixtureName)
    ? createUiFixture(fixtureName as UiFixtureName)
    : undefined;
const initialView =
  new URLSearchParams(window.location.search).get("view") === "settings"
    ? "settings"
    : "agent";
const initialSidebarCollapsed =
  new URLSearchParams(window.location.search).get("sidebar") === "collapsed" ||
  (!fixture &&
    localStorage.getItem("pi-ling.sidebar.collapsed") === "1");
const initialSidebarArchived =
  new URLSearchParams(window.location.search).get("sidebar-view") ===
  "archived";

export function App() {
  const [theme, setTheme] = useState(readInitialTheme);
  const [activeView, setActiveView] = useState<"agent" | "settings">(
    initialView,
  );
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initialSidebarCollapsed,
  );
  const [timeline, dispatch] = useReducer(
    timelineReducer,
    undefined,
    () => fixture?.timeline ?? createTimelineState(),
  );
  const [status, setStatus] = useState<AgentStatus | null>(
    fixture?.status ?? null,
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceListEntry[]>(
    fixture?.workspaces ?? [],
  );
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [liveMessageIds, setLiveMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showDshNotice, setShowDshNotice] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [changesSource, setChangesSource] = useState<ChangesSourceId>(
    DEFAULT_CHANGES_SOURCE,
  );
  const [changesFiles, setChangesFiles] = useState<ChangedFile[]>([]);
  const [rightPanelWidth, setRightPanelWidth] = useState<number | null>(() => {
    const stored = localStorage.getItem("pi-ling.workbench.width");
    if (!stored) return null;
    const parsed = Number(stored);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });
  const resizeRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const timelineCacheRef = useRef(new Map<string, typeof timeline>());
  const selectedSessionRef = useRef<string | null>(
    fixture?.status.sessionId ?? null,
  );
  const activationRevisionRef = useRef(0);

  useEffect(() => {
    const hasFixtureTheme = new URLSearchParams(window.location.search).has(
      "theme",
    );
    applyTheme(theme, !hasFixtureTheme);
    void window.piLing.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (fixture) return;
    const unsubscribe = window.piLing.onTimelineEvent((envelope) => {
      if (envelope.sessionId === selectedSessionRef.current) {
        dispatch({ type: "event", envelope });
        if (envelope.event.type === "assistant_end") {
          const messageId = envelope.event.itemId;
          setLiveMessageIds((current) => {
            const next = new Set(current);
            next.add(messageId);
            return next;
          });
        }
      } else {
        const cached =
          timelineCacheRef.current.get(envelope.sessionId) ??
          createTimelineState();
        timelineCacheRef.current.set(
          envelope.sessionId,
          timelineReducer(cached, { type: "event", envelope }),
        );
      }
      if (
        envelope.event.type === "run_end" ||
        envelope.event.type === "approval_requested" ||
        envelope.event.type === "approval_resolved" ||
        envelope.event.type === "changes"
      ) {
        void window.piLing.listWorkspaces(true).then(setWorkspaces);
      }
    });
    const unsubscribeFrames = window.piLing.onStreamFrame(
      (frame: StreamFrameEnvelope) => {
        if (frame.sessionId === selectedSessionRef.current) {
          dispatch({ type: "frame", frame });
        } else {
          const cached =
            timelineCacheRef.current.get(frame.sessionId) ??
            createTimelineState();
          const initialized =
            cached.sessionId === null
              ? { ...cached, sessionId: frame.sessionId }
              : cached;
          timelineCacheRef.current.set(
            frame.sessionId,
            timelineReducer(initialized, { type: "frame", frame }),
          );
        }
      },
    );

    void window.piLing.listWorkspaces(true).then(setWorkspaces);
    void window.piLing.getAgentStatus().then(async (initialStatus) => {
      if (initialStatus.sessionId) {
        applyActivation(
          await window.piLing.switchSession(initialStatus.sessionId),
        );
      } else {
        setStatus(initialStatus);
      }
    });

    return () => {
      unsubscribe();
      unsubscribeFrames();
    };
  }, []);

  useEffect(() => {
    if (timeline.sessionId) {
      timelineCacheRef.current.set(timeline.sessionId, timeline);
    }
  }, [timeline]);

  useEffect(() => {
    if (
      pendingRunId &&
      timeline.runs[pendingRunId] &&
      timeline.runs[pendingRunId].status !== "running"
    ) {
      setPendingRunId(null);
    }
  }, [pendingRunId, timeline.runs]);

  useEffect(() => {
    if (changesSource === "last-agent-turn") {
      setChangesFiles(
        lastAgentTurnChanges(timeline.items, timeline.runs),
      );
    } else {
      void window.piLing.getChanges().then(setChangesFiles);
    }
  }, [changesSource, timeline]);

  const activeRunId =
    pendingRunId ??
    Object.values(timeline.runs).find((run) => run.status === "running")?.id ??
    null;
  const finishMessagePresentation = useCallback((messageId: string) => {
    setLiveMessageIds((current) => {
      if (!current.has(messageId)) return current;
      const next = new Set(current);
      next.delete(messageId);
      return next;
    });
  }, []);

  function refreshChanges(source: ChangesSourceId = changesSource) {
    if (source === "last-agent-turn") {
      setChangesFiles(
        lastAgentTurnChanges(timeline.items, timeline.runs),
      );
      return;
    }
    void window.piLing.getChanges().then(setChangesFiles);
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightPanelWidth ?? parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--workbench-width"),
    );
    resizeRef.current = { startX, startWidth };
    const onMove = (moveEvent: PointerEvent) => {
      const ref = resizeRef.current;
      if (!ref) return;
      const delta = ref.startX - moveEvent.clientX;
      setRightPanelWidth(Math.max(320, Math.min(980, ref.startWidth + delta)));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function applyActivation(activation: SessionActivation): boolean {
    if (activation.activationRevision < activationRevisionRef.current) {
      return false;
    }
    if (timeline.sessionId) {
      timelineCacheRef.current.set(timeline.sessionId, timeline);
    }
    activationRevisionRef.current = activation.activationRevision;
    selectedSessionRef.current = activation.session.id;
    setActiveView("agent");
    setStatus(activation.status);
    setPendingRunId(null);
    setLiveMessageIds(new Set());
    dispatch({ type: "snapshot", snapshot: activation.snapshot });
    for (const frame of activation.bufferFrames) {
      dispatch({ type: "frame", frame });
    }
    void window.piLing.listWorkspaces(true).then(setWorkspaces);
    refreshChanges();
    return true;
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
      await window.piLing.sendPrompt({
        requestId: runId,
        prompt,
        ...(status?.sessionId ? { sessionId: status.sessionId } : {}),
      });
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

  const sessions = workspaces.flatMap((workspace) => workspace.sessions);
  const activeSession = sessions.find(
    (session) => session.id === status?.sessionId,
  );

  async function addWorkspace() {
    const workspace = await window.piLing.addWorkspace();
    if (workspace) {
      setWorkspaces(await window.piLing.listWorkspaces(true));
    }
  }

  async function newSession(workspaceId?: string) {
    setActiveView("agent");
    const targetWorkspaceId = workspaceId ?? activeSession?.workspaceId;
    if (!targetWorkspaceId) {
      await chooseWorkspace();
      return;
    }
    applyActivation(
      await window.piLing.createSession({
        workspaceId: targetWorkspaceId,
        runtimeKind: status?.runtimeKind ?? "native",
      }),
    );
  }

  async function switchSession(sessionId: string) {
    setActiveView("agent");
    if (sessionId === status?.sessionId) {
      return;
    }
    if (timeline.sessionId) {
      timelineCacheRef.current.set(timeline.sessionId, timeline);
    }
    selectedSessionRef.current = sessionId;
    setLiveMessageIds(new Set());
    const cached = timelineCacheRef.current.get(sessionId);
    if (cached) dispatch({ type: "replace", state: cached });
    applyActivation(await window.piLing.switchSession(sessionId));
  }

  async function changeApprovalMode(mode: ApprovalMode) {
    const updated = await window.piLing.setApprovalMode(mode);
    setStatus((current) =>
      current ? { ...current, approvalMode: mode } : current,
    );
    setWorkspaces((current) =>
      current.map((workspace) => ({
        ...workspace,
        sessions: workspace.sessions.map((session) =>
          session.id === updated.id ? updated : session,
        ),
      })),
    );
  }

  async function pinSession(sessionId: string, pinned: boolean) {
    await window.piLing.setSessionPinned(sessionId, pinned);
    setWorkspaces(await window.piLing.listWorkspaces(true));
  }

  async function archiveSession(sessionId: string) {
    const result = await window.piLing.archiveSession(sessionId);
    if (result.activation) {
      applyActivation(result.activation);
      return;
    }
    setWorkspaces(await window.piLing.listWorkspaces(true));
    if (status?.sessionId === sessionId) {
      const nextStatus = await window.piLing.getAgentStatus();
      selectedSessionRef.current = nextStatus.sessionId ?? null;
      setStatus(nextStatus);
      setPendingRunId(null);
      dispatch({
        type: "snapshot",
        snapshot: await window.piLing.getTimelineSnapshot(),
      });
    }
  }

  async function restoreSession(sessionId: string) {
    await window.piLing.restoreSession(sessionId);
    setWorkspaces(await window.piLing.listWorkspaces(true));
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
    setRuntimeError(null);
    if (!status?.workspace) {
      await chooseWorkspace(runtimeKind);
      return;
    }
    try {
      applyActivation(await window.piLing.switchRuntime(runtimeKind));
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const modelLabel = !status?.configured
    ? "缺少 DEEPSEEK_API_KEY"
    : status.workspace
      ? `${status.provider}/${status.model}`
      : "请选择工作区";
  const activeSessionTitle = activeSession?.title;

  return (
    <main className="shell">
      <AppTitleBar />
      <section
        style={
          rightPanelWidth
            ? ({ "--workbench-width": `${rightPanelWidth}px` } as React.CSSProperties)
            : undefined
        }
        className={`workspace ${
          activeView === "settings"
            ? "settings-workspace"
            : `${rightPanelOpen ? "right-panel-open" : ""} ${
                sidebarCollapsed ? "sidebar-collapsed" : ""
              }`
        }`}
      >
        {activeView === "settings" ? (
          <SettingsView
            theme={theme}
            onThemeChange={setTheme}
            onClose={() => setActiveView("agent")}
          />
        ) : (
          <>
            {!sidebarCollapsed ? (
              <Sidebar
                workspaces={workspaces}
                {...(status?.sessionId
                  ? { activeSessionId: status.sessionId }
                  : {})}
                availableRuntimes={
                  status?.availableRuntimes ?? ["native"]
                }
                initialArchived={initialSidebarArchived}
                onCollapse={() => {
                  localStorage.setItem("pi-ling.sidebar.collapsed", "1");
                  setSidebarCollapsed(true);
                }}
                onNewSession={(workspaceId) => void newSession(workspaceId)}
                onAddWorkspace={() => void addWorkspace()}
                onSelect={(sessionId) => void switchSession(sessionId)}
                onPin={(sessionId, pinned) =>
                  void pinSession(sessionId, pinned)
                }
                onArchive={(sessionId) => void archiveSession(sessionId)}
                onRestore={(sessionId) => void restoreSession(sessionId)}
                onOpenSettings={() => setActiveView("settings")}
              />
            ) : null}
            <section className="agent-pane">
              <AgentPaneToolbar
                {...(activeSessionTitle ? { title: activeSessionTitle } : {})}
                runtimeKind={status?.runtimeKind ?? "native"}
                sidebarCollapsed={sidebarCollapsed}
                rightPanelOpen={rightPanelOpen}
                onShowSidebar={() => {
                  localStorage.setItem("pi-ling.sidebar.collapsed", "0");
                  setSidebarCollapsed(false);
                }}
                onToggleRightPanel={() =>
                  setRightPanelOpen((current) => !current)
                }
              />
              <ChatView
                key={timeline.sessionId ?? "no-session"}
                sessionId={timeline.sessionId}
                items={timeline.items}
                runs={timeline.runs}
                liveMessageIds={liveMessageIds}
                onMessagePresented={finishMessagePresentation}
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
                runtimeError={runtimeError}
                onDismissRuntimeError={() => setRuntimeError(null)}
              />
            </section>
            {rightPanelOpen ? (
              <div
                className="workbench-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize workbench"
                onPointerDown={startResize}
              />
            ) : null}
            {rightPanelOpen ? (
              <WorkbenchPanel
                onClose={() => {
                  setRightPanelOpen(false);
                  if (rightPanelWidth) {
                    localStorage.setItem(
                      "pi-ling.workbench.width",
                      String(rightPanelWidth),
                    );
                  }
                }}
                changesSource={changesSource}
                changesFiles={changesFiles}
                onChangeSource={(source) => {
                  setChangesSource(source);
                  refreshChanges(source);
                }}
                onLoadDiff={(path) => window.piLing.getDiff(path)}
              />
            ) : null}
          </>
        )}
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
