import { useCallback, useRef, useState, type ReactNode } from "react";

import { AddToChatButton } from "../chat/AddToChatButton";
import { useComposerContextStore } from "../chat/composer-context-store";
import { capSnippetText, terminalSource } from "../chat/selection-context";
import {
  TerminalInstance,
  type TerminalMeta,
  type TerminalSelection,
  type TerminalStatus,
} from "./TerminalInstance";

const MAX_TERMINALS = 8;

type TerminalTab = {
  id: string;
  label: string;
};

function createTerminalTab(label: string): TerminalTab {
  return {
    id: `terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    label,
  };
}

function createInitialSessions(): TerminalTab[] {
  return [createTerminalTab("Terminal 1")];
}

export function TerminalPanel(props: {
  root: string;
  active: boolean;
  /** 会话 id：引用片段按会话隔离；缺失时不显示「加入对话」。 */
  sessionId?: string | undefined;
}) {
  const sequenceRef = useRef(1);
  const [sessions, setSessions] = useState<TerminalTab[]>(createInitialSessions);
  const [activeId, setActiveId] = useState(() => sessions[0]?.id ?? "");
  const [metaById, setMetaById] = useState<Record<string, TerminalMeta>>({});
  const [listOpen, setListOpen] = useState(false);
  const [selection, setSelection] = useState<TerminalSelection | null>(null);
  const addSnippet = useComposerContextStore((state) => state.add);

  const activeSession = sessions.find((session) => session.id === activeId);
  const activeMeta = activeSession ? metaById[activeSession.id] : undefined;

  const setTabMeta = useCallback((tabId: string, meta: TerminalMeta) => {
    setMetaById((current) => ({
      ...current,
      [tabId]: meta,
    }));
  }, []);

  const addTerminal = () => {
    if (sessions.length >= MAX_TERMINALS) return;
    const number = ++sequenceRef.current;
    const session = createTerminalTab(`Terminal ${number}`);
    setSessions((current) => [...current, session]);
    setActiveId(session.id);
    setListOpen(false);
  };

  const removeActiveTerminal = () => {
    if (!activeSession) return;
    const index = sessions.findIndex((item) => item.id === activeSession.id);
    const nextSessions = sessions.filter((item) => item.id !== activeSession.id);
    const replacement =
      nextSessions[Math.min(index, Math.max(0, nextSessions.length - 1))];
    setSessions(nextSessions);
    setActiveId(replacement?.id ?? "");
    setMetaById((current) => {
      const next = { ...current };
      delete next[activeSession.id];
      return next;
    });
    setListOpen(false);
  };

  const shellLabel = activeMeta?.shell
    ? activeMeta.shell.split(/[\\/]/).pop() ?? activeMeta.shell
    : "";

  return (
    <div
      className={`terminal-panel ${props.active ? "is-active" : "is-hidden"}`}
      aria-hidden={!props.active}
    >
      <header className="terminal-toolbar">
        <StatusDot status={activeMeta?.status ?? "connecting"} />
        <span
          className="terminal-cwd"
          title={activeMeta?.cwd || activeSession?.label}
        >
          {activeMeta?.cwd || activeSession?.label || "No terminal"}
        </span>
        {activeMeta?.exitCode !== null &&
        activeMeta?.exitCode !== undefined ? (
          <span className="terminal-exit-code">
            exit {activeMeta.exitCode}
          </span>
        ) : shellLabel ? (
          <span className="terminal-shell-label">{shellLabel}</span>
        ) : null}
        <TerminalIconButton
          label="新建终端"
          onClick={addTerminal}
          disabled={sessions.length >= MAX_TERMINALS}
        >
          <PlusIcon />
        </TerminalIconButton>
        <TerminalIconButton
          label="终端列表"
          onClick={() => setListOpen((open) => !open)}
          active={listOpen}
        >
          <TerminalListIcon />
          {sessions.length > 1 ? (
            <span className="terminal-tab-count">{sessions.length}</span>
          ) : null}
        </TerminalIconButton>
        <TerminalIconButton
          label="删除当前终端"
          onClick={removeActiveTerminal}
          disabled={!activeSession}
        >
          <TrashIcon />
        </TerminalIconButton>
      </header>

      {listOpen ? (
        <div className="terminal-list-popover">
          {sessions.length === 0 ? (
            <div className="terminal-list-empty">暂无终端</div>
          ) : (
            sessions.map((session) => {
              const meta = metaById[session.id];
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`terminal-list-item ${
                    session.id === activeId ? "active" : ""
                  }`}
                  onClick={() => {
                    setActiveId(session.id);
                    setListOpen(false);
                  }}
                >
                  <StatusDot status={meta?.status ?? "connecting"} />
                  <span className="terminal-list-label">{session.label}</span>
                  {meta?.exitCode !== null && meta?.exitCode !== undefined ? (
                    <span className="terminal-list-exit">
                      exit {meta.exitCode}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}

      {sessions.length === 0 ? (
        <button
          type="button"
          className="terminal-create-placeholder"
          onClick={addTerminal}
        >
          点击 + 创建终端
        </button>
      ) : (
        <div className="terminal-instances">
          {sessions.map((session) => (
            <TabTerminalInstance
              key={session.id}
              root={props.root}
              active={props.active}
              visible={session.id === activeId}
              onMeta={(meta) => setTabMeta(session.id, meta)}
              onSelectionChange={(selection) => {
                // 只认当前可见的那个终端，避免后台终端的选区抢走按钮
                if (session.id !== activeId) return;
                setSelection(selection);
              }}
            />
          ))}
        </div>
      )}

      {/*
        终端的「加入对话」。终端内容由 xterm 自己渲染、没有可选的 DOM 文本，
        所以选区来自 `terminal.getSelection()`，坐标由 xterm 的行列 API 换算。
      */}
      {selection && props.sessionId ? (
        <AddToChatButton
          anchor={selection.anchor}
          title={selection.text.slice(0, 200)}
          onAdd={() => {
            const capped = capSnippetText(selection.text);
            addSnippet(props.sessionId!, {
              text: capped.text,
              source: terminalSource(),
            });
            setSelection(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TabTerminalInstance(props: {
  root: string;
  active: boolean;
  visible: boolean;
  onMeta: (meta: TerminalMeta) => void;
  onSelectionChange: (selection: TerminalSelection | null) => void;
}) {
  const onMetaRef = useRef(props.onMeta);
  onMetaRef.current = props.onMeta;
  const handleMeta = useCallback((meta: TerminalMeta) => {
    onMetaRef.current(meta);
  }, []);
  // 终端选区回调不进 effect 依赖（否则每次渲染都要重建终端），故走 ref
  const onSelectionChangeRef = useRef(props.onSelectionChange);
  onSelectionChangeRef.current = props.onSelectionChange;
  const handleSelectionChange = useCallback(
    (selection: TerminalSelection | null) => {
      onSelectionChangeRef.current(selection);
    },
    [],
  );

  return (
    <TerminalInstance
      root={props.root}
      active={props.active}
      visible={props.visible}
      onMeta={handleMeta}
      onSelectionChange={handleSelectionChange}
    />
  );
}

function StatusDot({ status }: { status: TerminalStatus }) {
  return (
    <span
      className={`terminal-status-dot status-${status}`}
      aria-hidden="true"
    />
  );
}

function TerminalIconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.label}
      aria-label={props.label}
      className={`terminal-icon-button ${props.active ? "active" : ""}`}
    >
      {props.children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor">
      <path d="M8 3v10M3 8h10" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TerminalListIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor">
      <rect x="2.5" y="3" width="11" height="9.5" rx="1.5" strokeWidth="1.2" />
      <path
        d="m5 6 2 1.7L5 9.4M8.5 9.5h2.5"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor">
      <path
        d="M3.5 5h9M6 5V3.5h4V5m1.5 0-.5 8H5L4.5 5"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
