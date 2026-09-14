import type {
  AgentStatus,
  ApprovalMode,
  BackgroundTask,
  ComposerMode,
  ChangedFile,
  PromptAttachment,
  RuntimeKind,
  SessionActivation,
  StreamFrameEnvelope,
  TimelineEnvelope,
  WorkspaceListEntry,
} from "@pi-ling/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { BackgroundTasksContext } from "./features/chat/background-tasks-context";
import { ChatView } from "./features/chat/ChatView";
import {
  AgentPaneToolbar,
  AppTitleBar,
  WorkbenchPanel,
} from "./features/shell/WorkbenchChrome";
import { SessionActivationOverlay } from "./features/shell/SessionActivationOverlay";
import {
  bindFilesTabActivator,
  refreshFilesThrottled,
  useFilesStore,
} from "./features/files/store";
import { SettingsView } from "./features/settings/SettingsView";
import { Sidebar } from "./features/threads/Sidebar";
import {
  DEFAULT_CHANGES_SOURCE,
  type ChangesSourceId,
} from "./features/details/changes-source";
import {
  changesFilesByRunId,
  lastAgentTurnChanges,
  reconcileLastAgentTurnChanges,
} from "./run-activity/run-changes";
import { bindChangesNavigation } from "./features/details/changes-navigation";
import { bindPlansNavigation } from "./features/plans/plans-navigation";
import {
  buildPlanPrompt,
  resolvePlanBuildRuns,
  writePlanBuildRun,
} from "./features/plans/plan-build-runs";
import { findPlanReadyForBuild } from "./features/plans/project-session-plans";
import type { SessionPlan } from "./features/plans/types";
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
const initialRightPanelOpen = false;

function areChangedFilesEqual(
  left: readonly ChangedFile[],
  right: readonly ChangedFile[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((file, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      file.path === other.path &&
      file.status === other.status &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.sensitive === other.sensitive &&
      file.binary === other.binary &&
      file.tooLarge === other.tooLarge
    );
  });
}

function isFileAffectingTool(tool: string): boolean {
  const lower = tool.toLowerCase();
  return /(write|edit|patch|create_file|str_replace|delete|rename|move)/.test(
    lower,
  );
}

export function App() {
  const [theme, setTheme] = useState(readInitialTheme);  const [activeView, setActiveView] = useState<"agent" | "settings">(
    initialView,
  );
  const [rightPanelOpen, setRightPanelOpen] = useState(initialRightPanelOpen);
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
  const [backgroundTasksByCallId, setBackgroundTasksByCallId] = useState<
    Map<string, BackgroundTask>
  >(() => new Map());
  const [showDshNotice, setShowDshNotice] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeSwitching, setRuntimeSwitching] = useState(false);
  const [runtimeSwitchTarget, setRuntimeSwitchTarget] =
    useState<RuntimeKind | null>(null);
  const [sessionInitializing, setSessionInitializing] = useState(
    () => !fixture,
  );
  const [sessionInitializingMessage, setSessionInitializingMessage] =
    useState("正在初始化…");
  const [changesSource, setChangesSource] = useState<ChangesSourceId>(
    DEFAULT_CHANGES_SOURCE,
  );
  const [changesFiles, setChangesFiles] = useState<ChangedFile[]>([]);
  const [reconciledLastTurnChanges, setReconciledLastTurnChanges] =
    useState<ChangedFile[]>([]);
  const [changesLoading, setChangesLoading] = useState(true);
  const [reviewRunId, setReviewRunId] = useState<string | null>(null);
  const [requestedWorkbenchTab, setRequestedWorkbenchTab] = useState<
    "files" | "changes" | "terminal" | "plans" | "trace" | "eval" | null
  >(null);
  const [plansFocusRunId, setPlansFocusRunId] = useState<string | null>(null);
  const [planBuildPending, setPlanBuildPending] = useState(false);
  const [planBuildRuns, setPlanBuildRuns] = useState<Map<string, string>>(
    () => new Map(),
  );
  const seenPlanReadyKeysRef = useRef(new Set<string>());
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
    const unsubscribe = window.piLing.onTaskUpdated(({ sessionId, task }) => {
      if (sessionId !== selectedSessionRef.current) return;
      setBackgroundTasksByCallId((current) => {
        const next = new Map(current);
        next.set(task.parentToolCallId, task);
        return next;
      });
    });
    return unsubscribe;
  }, [fixture]);

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
        envelope.event.type === "changes" ||
        (envelope.event.type === "tool_end" &&
          isFileAffectingTool(envelope.event.tool))
      ) {
        void window.piLing.listWorkspaces(true).then(setWorkspaces);
        debouncedRefreshChangesRef.current?.();
      }
      if (
        envelope.event.type === "run_end" ||
        envelope.event.type === "changes" ||
        (envelope.event.type === "tool_end" &&
          isFileAffectingTool(envelope.event.tool))
      ) {
        refreshFilesThrottled();
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
      try {
        if (initialStatus.sessionId) {
          applyActivation(
            await window.piLing.switchSession(initialStatus.sessionId),
          );
        } else {
          setStatus(initialStatus);
        }
      } finally {
        setSessionInitializing(false);
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

  const lastTurnChanges = useMemo(
    () => lastAgentTurnChanges(timeline.items, timeline.runs),
    [timeline.items, timeline.runs],
  );
  const traceEvents = useMemo(
    () =>
      Object.values(timeline.received).sort(
        (left, right) => left.seq - right.seq,
      ),
    [timeline.received],
  );
  const lastTurnChangesRef = useRef(lastTurnChanges);
  lastTurnChangesRef.current = lastTurnChanges;
  const changesSourceRef = useRef(changesSource);
  changesSourceRef.current = changesSource;

  const syncLastAgentTurnChanges = useCallback((turnFiles: ChangedFile[]) => {
      if (turnFiles.length === 0) {
        setChangesLoading(false);
        setReconciledLastTurnChanges((current) =>
          current.length === 0 ? current : [],
        );
        return;
      }
      setChangesLoading(true);
      void window.piLing
        .getChanges("last-agent-turn")
        .then((netFiles) => {
          const next = reconcileLastAgentTurnChanges(turnFiles, netFiles);
          setReconciledLastTurnChanges((current) =>
            areChangedFilesEqual(current, next) ? current : next,
          );
        })
        .finally(() => {
          setChangesLoading(false);
        });
  }, []);

  const refreshChanges = useCallback((source?: ChangesSourceId) => {
    const resolved = source ?? changesSourceRef.current;
    if (resolved === "last-agent-turn") {
      syncLastAgentTurnChanges(
        reviewRunId
          ? changesFilesByRunId(timeline.items, reviewRunId)
          : lastTurnChangesRef.current,
      );
      return;
    }
    /*
     * 后台刷新：**保留现有内容**，不清空、不进 loading 遮罩。
     *
     * 这个函数由 agent 事件（run_end / changes / 影响文件的 tool_end）防抖触发，
     * 输出期间会反复调用。若在这里清空列表，整个面板会闪成「正在加载变更…」，
     * 而且所有 FileSection 会卸载重挂载、把每个文件的 diff 重新取一遍 ——
     * 观感就是持续闪烁。实测：清空方案在 t=60ms 时 sections=0、loading=1。
     */
    void window.piLing.getChanges(resolved).then(setChangesFiles);
  }, [reviewRunId, syncLastAgentTurnChanges, timeline.items]);

  const debouncedRefreshChangesRef = useRef<(() => void) | null>(null);
  if (!debouncedRefreshChangesRef.current) {
    debouncedRefreshChangesRef.current = (() => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          refreshChanges();
        }, 120);
      };
    })();
  }

  /*
   * ① 来源切换：清空并重取。
   *
   * 这是**用户主动操作**（点 Source 下拉），短暂 loading 可以接受，而且清空是
   * 语义正确的 —— 上一个来源的文件不该留在屏幕上。
   *
   * 依赖里**只能有 changesSource**。原先把 timeline.items / lastTurnChanges /
   * reviewRunId 也放进来了，但这一分支根本不用它们 —— 结果是 agent 输出期间
   * 每个流事件都会重跑本 effect，把面板闪成空白（这是「发消息就闪一下」的根因）。
   * last-agent-turn 的同步见下面的 ②。
   */
  useEffect(() => {
    if (changesSource === "last-agent-turn") return;
    let cancelled = false;
    setChangesLoading(true);
    setChangesFiles([]);
    const timer = window.setTimeout(() => {
      void window.piLing
        .getChanges(changesSource)
        .then((files) => {
          if (!cancelled) setChangesFiles(files);
        })
        .finally(() => {
          if (!cancelled) setChangesLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [changesSource]);

  /*
   * ② last-agent-turn：数据由 timeline 推导，所以这里**必须**跟着 items 变。
   * 提前 return 保证其它来源不会因此被牵连重取。
   */
  useEffect(() => {
    if (changesSource !== "last-agent-turn") return;
    syncLastAgentTurnChanges(
      reviewRunId
        ? changesFilesByRunId(timeline.items, reviewRunId)
        : lastTurnChanges,
    );
  }, [
    changesSource,
    lastTurnChanges,
    reviewRunId,
    syncLastAgentTurnChanges,
    timeline.items,
  ]);

  const displayedChangesFiles = useMemo(() => {
    if (changesSource !== "last-agent-turn") return changesFiles;
    return reconciledLastTurnChanges;
  }, [changesSource, changesFiles, reconciledLastTurnChanges]);

  const openAgentTurnReview = useCallback((runId: string) => {
    setReviewRunId(runId);
    setChangesSource("last-agent-turn");
    setChangesLoading(false);
    setRightPanelOpen(true);
    setRequestedWorkbenchTab("changes");
  }, []);

  useEffect(() => {
    bindChangesNavigation({
      activateChangesTab: () => {
        setRightPanelOpen(true);
        setRequestedWorkbenchTab("changes");
      },
      onReviewRun: (runId) => {
        setReviewRunId(runId);
        setChangesSource("last-agent-turn");
        setChangesLoading(false);
        setRightPanelOpen(true);
        setRequestedWorkbenchTab("changes");
      },
    });
    return () => {
      bindChangesNavigation({
        activateChangesTab: () => {},
        onReviewRun: () => {},
      });
    };
  }, []);

  useEffect(() => {
    bindPlansNavigation({
      activatePlansTab: (runId) => {
        if (runId) setPlansFocusRunId(runId);
        setRightPanelOpen(true);
        setRequestedWorkbenchTab("plans");
      },
    });
    return () => {
      bindPlansNavigation({
        activatePlansTab: () => {},
      });
    };
  }, []);

  useEffect(() => {
    bindFilesTabActivator(() => {
      setRightPanelOpen(true);
      setRequestedWorkbenchTab("files");
    });
    return () => bindFilesTabActivator(() => {});
  }, []);

  useEffect(() => {
    seenPlanReadyKeysRef.current.clear();
    setPlansFocusRunId(null);
    setPlanBuildPending(false);
  }, [timeline.sessionId]);

  useEffect(() => {
    setPlanBuildRuns(
      resolvePlanBuildRuns(timeline.sessionId, timeline.items),
    );
  }, [timeline.sessionId, timeline.items]);

  useEffect(() => {
    const ready = findPlanReadyForBuild({
      items: timeline.items,
      runs: timeline.runs,
      runtimeKind: status?.runtimeKind ?? "native",
      buildRunByPlanRunId: planBuildRuns,
    });
    if (!ready) return;
    const key = `${ready.runId}:${ready.callId}`;
    if (seenPlanReadyKeysRef.current.has(key)) return;
    seenPlanReadyKeysRef.current.add(key);
    setPlansFocusRunId(ready.runId);
    setRightPanelOpen(true);
    setRequestedWorkbenchTab("plans");
  }, [timeline.items, timeline.runs, status?.runtimeKind, planBuildRuns]);

  const workspaceRoot = status?.workspace?.root;

  useEffect(() => {
    useFilesStore.getState().resetForRoot();
  }, [workspaceRoot]);

  const loadDiff = useCallback(
    (path: string) => window.piLing.getDiff(path, changesSourceRef.current),
    [],
  );

  const loadDiffContents = useCallback(
    (path: string) =>
      window.piLing.getDiffFileContents(path, changesSourceRef.current),
    [],
  );

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

  function hydrateBackgroundTasks(
    tasks: readonly BackgroundTask[],
  ): Map<string, BackgroundTask> {
    return new Map(tasks.map((task) => [task.parentToolCallId, task]));
  }

  async function withSessionInitialization<T>(
    message: string,
    action: () => Promise<T>,
  ): Promise<T> {
    setSessionInitializingMessage(message);
    setSessionInitializing(true);
    try {
      return await action();
    } finally {
      setSessionInitializing(false);
    }
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
    setBackgroundTasksByCallId(
      hydrateBackgroundTasks(activation.backgroundTasks),
    );
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
    await withSessionInitialization("正在打开工作区…", async () => {
      const activation = await window.piLing.selectWorkspace(runtimeKind);
      if (!activation) {
        return;
      }
      dispatch({ type: "clear" });
      applyActivation(activation);
    });
  }

  async function sendPrompt(
    prompt: string,
    attachments?: PromptAttachment[],
    requestId?: string,
  ) {
    const runId = requestId ?? crypto.randomUUID();
    setPendingRunId(runId);
    try {
      await window.piLing.sendPrompt({
        requestId: runId,
        prompt,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
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

  async function answerQuestion(
    item: import("./timeline/reducer").QuestionTimelineItem,
    answers: import("@pi-ling/contracts").AskUserAnswer[],
  ) {
    await window.piLing.resolveQuestion({
      callId: item.question.callId,
      answers,
    });
  }

  const resolvePlanDecision = useCallback(
    async (plan: SessionPlan, approved: boolean) => {
      if (!plan.pendingApproval) return;
      const approval = timeline.items.find(
        (item): item is ApprovalTimelineItem =>
          item.kind === "approval" &&
          item.id === plan.pendingApproval?.approvalItemId &&
          item.status === "pending",
      );
      if (!approval) return;
      setPlanBuildPending(true);
      try {
        await decide(approval, approved);
      } finally {
        setPlanBuildPending(false);
      }
    },
    [timeline.items],
  );

  const handlePlanBuild = useCallback(
    async (plan: SessionPlan) => {
      const runtimeKind = status?.runtimeKind ?? "native";
      if (runtimeKind === "dsh") {
        await resolvePlanDecision(plan, true);
        return;
      }
      if (runtimeKind === "codex") {
        if (plan.status !== "ready" || !timeline.sessionId) return;
        const buildRunId = crypto.randomUUID();
        setPlanBuildPending(true);
        try {
          setPlanBuildRuns(
            writePlanBuildRun(timeline.sessionId, plan.runId, buildRunId),
          );
          await sendPrompt(
            buildPlanPrompt(plan.markdown),
            undefined,
            buildRunId,
          );
        } finally {
          setPlanBuildPending(false);
        }
        return;
      }
      if (plan.status !== "ready" || !timeline.sessionId) return;
      const buildRunId = crypto.randomUUID();
      setPlanBuildPending(true);
      try {
        setPlanBuildRuns(
          writePlanBuildRun(timeline.sessionId, plan.runId, buildRunId),
        );
        await sendPrompt(buildPlanPrompt(plan.markdown), undefined, buildRunId);
      } finally {
        setPlanBuildPending(false);
      }
    },
    [resolvePlanDecision, status?.runtimeKind, timeline.sessionId],
  );

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
    await withSessionInitialization("正在创建会话…", async () => {
      applyActivation(
        await window.piLing.createSession({
          workspaceId: targetWorkspaceId,
          runtimeKind: status?.runtimeKind ?? "native",
        }),
      );
    });
  }

  async function switchSession(sessionId: string) {
    setActiveView("agent");
    if (sessionId === status?.sessionId) {
      return;
    }
    await withSessionInitialization("正在加载会话…", async () => {
      if (timeline.sessionId) {
        timelineCacheRef.current.set(timeline.sessionId, timeline);
      }
      selectedSessionRef.current = sessionId;
      setLiveMessageIds(new Set());
      const cached = timelineCacheRef.current.get(sessionId);
      if (cached) dispatch({ type: "replace", state: cached });
      applyActivation(await window.piLing.switchSession(sessionId));
    });
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

  async function changeComposerMode(mode: ComposerMode) {
    const updated = await window.piLing.setComposerMode(mode);
    setStatus((current) =>
      current ? { ...current, composerMode: mode } : current,
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
      await withSessionInitialization("正在切换会话…", async () => {
        applyActivation(result.activation!);
      });
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
    if (runtimeKind === status?.runtimeKind || runtimeSwitching) return;
    if (
      runtimeKind === "dsh" &&
      localStorage.getItem("pi-ling.dsh-safety-accepted") !== "1"
    ) {
      setShowDshNotice(true);
      return;
    }
    setRuntimeError(null);
    setRuntimeSwitching(true);
    setRuntimeSwitchTarget(runtimeKind);
    try {
      if (!status?.workspace) {
        await chooseWorkspace(runtimeKind);
        return;
      }
      applyActivation(await window.piLing.switchRuntime(runtimeKind));
    } catch (error) {
      setRuntimeError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRuntimeSwitching(false);
      setRuntimeSwitchTarget(null);
    }
  }

  const activeSessionTitle = activeSession?.title;

  return (
    <main className="shell">
      {sessionInitializing ? (
        <SessionActivationOverlay message={sessionInitializingMessage} />
      ) : null}
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
                onToggleRightPanel={() => {
                  setRightPanelOpen((current) => {
                    if (!current) {
                      setRequestedWorkbenchTab("trace");
                    }
                    return !current;
                  });
                }}
              />
              <BackgroundTasksContext.Provider value={backgroundTasksByCallId}>
                <ChatView
                  key={timeline.sessionId ?? "no-session"}
                  sessionId={timeline.sessionId}
                  items={timeline.items}
                  runs={timeline.runs}
                  liveMessageIds={liveMessageIds}
                  onMessagePresented={finishMessagePresentation}
                  workspaceReady={Boolean(status?.workspace)}
                  configured={status?.configured ?? false}
                  workspaceRoot={workspaceRoot}
                  activeRunId={activeRunId}
                  approvalMode={status?.approvalMode ?? "manual"}
                  composerMode={status?.composerMode ?? "agent"}
                  runtimeKind={status?.runtimeKind ?? "native"}
                  availableRuntimes={status?.availableRuntimes ?? ["native"]}
                  onSend={sendPrompt}
                  onCancel={(runId) => {
                    void window.piLing.cancelPrompt(runId);
                  }}
                  onApproval={decide}
                  onQuestion={answerQuestion}
                  onApprovalModeChange={changeApprovalMode}
                  onComposerModeChange={changeComposerMode}
                  onRuntimeChange={(runtime) => {
                    void activateRuntime(runtime);
                  }}
                  runtimeError={runtimeError}
                  onDismissRuntimeError={() => setRuntimeError(null)}
                  onReviewTurnChanges={openAgentTurnReview}
                  runtimeSwitching={runtimeSwitching}
                  runtimeSwitchTarget={runtimeSwitchTarget}
                />
              </BackgroundTasksContext.Provider>
            </section>
            {rightPanelOpen ? (
              <div className="workbench-shell">
                <div
                  className="workbench-resize-handle"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize workbench"
                  onPointerDown={startResize}
                />
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
                  changesFiles={displayedChangesFiles}
                  changesLoading={changesLoading}
                  onChangeSource={(source) => {
                    setReviewRunId(null);
                    setChangesSource(source);
                    refreshChanges(source);
                  }}
                  onLoadDiff={loadDiff}
                  onLoadDiffContents={loadDiffContents}
                  filesRoot={workspaceRoot}
                  filesSessionId={timeline.sessionId ?? undefined}
                  terminalRoot={workspaceRoot}
                  terminalSessionId={timeline.sessionId ?? undefined}
                  traceSessionId={timeline.sessionId}
                  traceEvents={traceEvents}
                  traceRuns={timeline.runs}
                  traceActiveRunId={activeRunId}
                  plansSessionId={timeline.sessionId}
                  plansItems={timeline.items}
                  plansRuns={timeline.runs}
                  plansActiveRunId={activeRunId}
                  plansFocusRunId={plansFocusRunId}
                  plansRuntimeKind={status?.runtimeKind ?? "native"}
                  planBuildRuns={planBuildRuns}
                  onBuildPlan={(plan) => void handlePlanBuild(plan)}
                  onCancelPlan={(plan) =>
                    void resolvePlanDecision(plan, false)
                  }
                  planBuildPending={planBuildPending}
                  streaming={Boolean(activeRunId)}
                  requestedTab={requestedWorkbenchTab}
                  onRequestedTabApplied={() => {
                    setRequestedWorkbenchTab(null);
                    setPlansFocusRunId(null);
                  }}
                />
              </div>
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
