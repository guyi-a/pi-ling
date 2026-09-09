import type { ChangedFile, FileDiff, TimelineEnvelope } from "@pi-ling/contracts";
import type { RuntimeKind } from "@pi-ling/contracts";
import {
  ChevronsRight,
  PanelLeftOpen,
  PanelRight,
  Plus,
} from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";

import type { ChangesSourceId } from "../details/changes-source";
import { ChangesView } from "../details/ChangesView";
import { FilesPanel } from "../files/FilesPanel";
import { bindFilesTabActivator, useFilesStore } from "../files/store";
import { TerminalEmptyState } from "../terminal/TerminalEmptyState";

import type { TimelineItem, TimelineRun } from "../../timeline/reducer";
import type { SessionPlan } from "../plans/types";

const TerminalPanel = lazy(() =>
  import("../terminal/TerminalView").then((module) => ({
    default: module.TerminalPanel,
  })),
);

const TracePanel = lazy(() =>
  import("../trace/TraceView").then((module) => ({
    default: module.TracePanel,
  })),
);

const PlansPanel = lazy(() =>
  import("../plans/PlansView").then((module) => ({
    default: module.PlansPanel,
  })),
);

const EvalPanel = lazy(() =>
  import("../eval/EvalPanel").then((module) => ({
    default: module.EvalPanel,
  })),
);

export function AppTitleBar() {
  return (
    <header className="app-titlebar">
      <nav className="application-menu" aria-label="Application menu">
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span>Help</span>
      </nav>
      <div className="window-title">
        <span className="window-mark">π</span>
        <span>pi-ling</span>
      </div>
    </header>
  );
}

export function AgentPaneToolbar(props: {
  title?: string;
  runtimeKind: RuntimeKind;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  onShowSidebar: () => void;
  onToggleRightPanel: () => void;
}) {
  return (
    <header className="pane-toolbar agent-pane-toolbar">
      <div className="toolbar-leading">
        {props.sidebarCollapsed ? (
          <button
            className="icon-button"
            type="button"
            title="Show sidebar"
            aria-label="Show sidebar"
            onClick={props.onShowSidebar}
          >
            <PanelLeftOpen />
          </button>
        ) : null}
      </div>
      <div className="pane-title" title={props.title}>
        {props.title ?? "New agent"}
      </div>
      <div className="toolbar-actions">
        <button
          className={`icon-button ${props.rightPanelOpen ? "selected" : ""}`}
          type="button"
          aria-label={
            props.rightPanelOpen ? "Hide workbench" : "Show workbench"
          }
          aria-pressed={props.rightPanelOpen}
          onClick={props.onToggleRightPanel}
        >
          <PanelRight />
        </button>
      </div>
    </header>
  );
}

const WORKBENCH_TAB_STORAGE_KEY = "pi-ling.workbench.tab";

const workbenchTabs = [
  {
    id: "files",
    label: "Files",
    description:
      "选择工作区后，可在此浏览文件并预览内容（仅只读）。",
  },
  {
    id: "changes",
    label: "Changes",
    description: "Agent file changes will appear here.",
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Terminal sessions will open in this pane.",
  },
  {
    id: "plans",
    label: "Plans",
    description: "Agent plans will appear here.",
  },
  {
    id: "trace",
    label: "Trace",
    description: "Run events and model calls will appear here.",
  },
  {
    id: "eval",
    label: "Eval",
    description: "Regression eval catalog and ledger summary.",
  },
] as const;

type WorkbenchTab = (typeof workbenchTabs)[number]["id"];

function readInitialWorkbenchTab(): WorkbenchTab {
  if (typeof localStorage === "undefined") return "files";
  const stored = localStorage.getItem(WORKBENCH_TAB_STORAGE_KEY);
  if (stored && workbenchTabs.some((tab) => tab.id === stored)) {
    return stored as WorkbenchTab;
  }
  return "files";
}

export function WorkbenchPanel(props: {
  onClose: () => void;
  changesSource?: ChangesSourceId;
  changesFiles?: ChangedFile[];
  changesLoading?: boolean;
  onChangeSource?: (source: ChangesSourceId) => void;
  onLoadDiff?: (path: string) => Promise<FileDiff | undefined>;
  filesRoot?: string | undefined;
  terminalRoot?: string | undefined;
  traceSessionId?: string | null;
  traceEvents?: TimelineEnvelope[];
  traceRuns?: Record<string, TimelineRun>;
  traceActiveRunId?: string | null;
  plansSessionId?: string | null;
  plansItems?: TimelineItem[];
  plansRuns?: Record<string, TimelineRun>;
  plansActiveRunId?: string | null;
  plansFocusRunId?: string | null;
  plansRuntimeKind?: RuntimeKind;
  planBuildRuns?: ReadonlyMap<string, string>;
  onBuildPlan?: (plan: SessionPlan) => void;
  onCancelPlan?: (plan: SessionPlan) => void;
  planBuildPending?: boolean;
  streaming?: boolean;
  initialTab?: WorkbenchTab;
  requestedTab?: WorkbenchTab | null;
  onRequestedTabApplied?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(
    () => props.initialTab ?? props.requestedTab ?? readInitialWorkbenchTab(),
  );
  const [terminalMounted, setTerminalMounted] = useState(
    () => activeTab === "terminal",
  );
  const [traceMounted, setTraceMounted] = useState(
    () => activeTab === "trace",
  );
  const [plansMounted, setPlansMounted] = useState(
    () => activeTab === "plans",
  );
  const [evalMounted, setEvalMounted] = useState(
    () => activeTab === "eval",
  );
  const active = workbenchTabs.find((tab) => tab.id === activeTab)!;

  useEffect(() => {
    if (activeTab === "terminal") setTerminalMounted(true);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "trace") setTraceMounted(true);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "plans") setPlansMounted(true);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "eval") setEvalMounted(true);
  }, [activeTab]);

  useEffect(() => {
    bindFilesTabActivator(() => setActiveTab("files"));
    return () => bindFilesTabActivator(() => {});
  }, []);

  useEffect(() => {
    if (!props.requestedTab) return;
    setActiveTab(props.requestedTab);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(WORKBENCH_TAB_STORAGE_KEY, props.requestedTab);
    }
    props.onRequestedTabApplied?.();
  }, [props.requestedTab, props.onRequestedTabApplied]);

  useEffect(() => {
    if (props.streaming && props.filesRoot) {
      useFilesStore.getState().refreshFiles();
    }
  }, [props.filesRoot, props.streaming]);

  const renderChanges =
    activeTab === "changes" &&
    props.changesSource &&
    props.changesFiles &&
    props.onChangeSource &&
    props.onLoadDiff;

  const showTerminalEmpty = activeTab === "terminal" && !props.terminalRoot;
  const showGenericEmpty =
    activeTab !== "files" &&
    activeTab !== "changes" &&
    activeTab !== "terminal" &&
    activeTab !== "plans" &&
    activeTab !== "trace" &&
    activeTab !== "eval";

  return (
    <aside className="workbench-panel" aria-label="Workbench">
      <header className="workbench-tabs" role="tablist">
        <div className="workbench-tab-scroll">
          {workbenchTabs.map((tab) => (
            <button
              className={`workbench-tab ${
                activeTab === tab.id ? "active" : ""
              }`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (typeof localStorage !== "undefined") {
                  localStorage.setItem(WORKBENCH_TAB_STORAGE_KEY, tab.id);
                }
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button className="icon-button" type="button" disabled aria-label="New">
          <Plus />
        </button>
        <button
          className="icon-button close-workbench"
          type="button"
          aria-label="Hide workbench"
          onClick={props.onClose}
        >
          <ChevronsRight />
        </button>
      </header>
      <div className="workbench-body" role="tabpanel">
        {activeTab === "files" ? (
          <FilesPanel {...(props.filesRoot ? { root: props.filesRoot } : {})} />
        ) : renderChanges ? (
          <ChangesView
            source={props.changesSource!}
            files={props.changesFiles!}
            loading={props.changesLoading}
            onSourceChange={props.onChangeSource!}
            getDiff={props.onLoadDiff!}
          />
        ) : showTerminalEmpty ? (
          <TerminalEmptyState />
        ) : showGenericEmpty ? (
          <div className="workbench-empty">
            <span className="empty-pane-mark">{active.label.slice(0, 1)}</span>
            <strong>{active.label}</strong>
            <p>{active.description}</p>
          </div>
        ) : null}
        {terminalMounted && props.terminalRoot ? (
          <Suspense fallback={null}>
            <TerminalPanel
              key={props.terminalRoot}
              root={props.terminalRoot}
              active={activeTab === "terminal"}
            />
          </Suspense>
        ) : null}
        {plansMounted ? (
          <Suspense fallback={null}>
            <PlansPanel
              key={props.plansSessionId ?? "no-session"}
              sessionId={props.plansSessionId ?? null}
              items={props.plansItems ?? []}
              runs={props.plansRuns ?? {}}
              activeRunId={props.plansActiveRunId ?? null}
              focusRunId={props.plansFocusRunId ?? null}
              active={activeTab === "plans"}
              runtimeKind={props.plansRuntimeKind ?? "native"}
              buildRunByPlanRunId={props.planBuildRuns}
              onBuild={props.onBuildPlan}
              onCancelPlan={props.onCancelPlan}
              buildPending={props.planBuildPending}
            />
          </Suspense>
        ) : null}
        {traceMounted ? (
          <Suspense fallback={null}>
            <TracePanel
              key={props.traceSessionId ?? "no-session"}
              sessionId={props.traceSessionId ?? null}
              events={props.traceEvents ?? []}
              runs={props.traceRuns ?? {}}
              activeRunId={props.traceActiveRunId ?? null}
              active={activeTab === "trace"}
            />
          </Suspense>
        ) : null}
        {evalMounted ? (
          <Suspense fallback={null}>
            <EvalPanel />
          </Suspense>
        ) : null}
      </div>
    </aside>
  );
}
