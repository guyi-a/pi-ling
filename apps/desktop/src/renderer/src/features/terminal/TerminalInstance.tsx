import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { useFilesStore } from "../files/store";

function readCssColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function buildTerminalTheme() {
  return {
    background: readCssColor("--code-bg", "#171717"),
    foreground: readCssColor("--text-soft", "#dedede"),
    cursor: readCssColor("--accent-strong", "#7aded3"),
    selectionBackground: readCssColor("--surface-selected", "#37373d"),
    red: readCssColor("--danger", "#f5927e"),
    green: readCssColor("--success", "#7fd99a"),
    yellow: readCssColor("--warning", "#e0c04a"),
    blue: readCssColor("--info", "#7eb6ff"),
    magenta: readCssColor("--tool-command", "#c792ea"),
    cyan: readCssColor("--accent", "#5ec4bc"),
  };
}

export type TerminalStatus = "connecting" | "ready" | "exited" | "error";

export type TerminalMeta = {
  status: TerminalStatus;
  cwd: string;
  shell: string;
  exitCode: number | null;
};

export function TerminalInstance(props: {
  root: string;
  active: boolean;
  visible: boolean;
  onMeta: (meta: TerminalMeta) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const metaRef = useRef<TerminalMeta>({
    status: "connecting",
    cwd: "",
    shell: "",
    exitCode: null,
  });
  const refreshTree = useFilesStore((state) => state.refreshTree);
  const onMetaRef = useRef(props.onMeta);
  onMetaRef.current = props.onMeta;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !props.root) return;

    let disposed = false;
    const emitMeta = (meta: TerminalMeta) => {
      metaRef.current = meta;
      onMetaRef.current(meta);
    };
    emitMeta({
      status: "connecting",
      cwd: "",
      shell: "",
      exitCode: null,
    });

    const scheduleWorkspaceRefresh = (delay = 400) => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        refreshTree();
      }, delay);
    };

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: buildTerminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const sendResize = () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      void window.piLing.terminalResize(
        sessionId,
        terminal.cols,
        terminal.rows,
      );
    };

    const resizeObserver = new ResizeObserver(() => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
        sendResize();
      } catch {
        // Hidden terminals have no measurable viewport yet.
      }
    });
    resizeObserver.observe(host);

    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      void window.piLing.terminalInput(
        sessionId,
        new TextEncoder().encode(data),
      );
      if (data.includes("\r") || data.includes("\n")) {
        scheduleWorkspaceRefresh(800);
      }
    });

    const unsubscribeOutput = window.piLing.onTerminalOutput((event) => {
      if (disposed || event.sessionId !== sessionIdRef.current) return;
      terminal.write(event.data);
      scheduleWorkspaceRefresh();
    });

    const unsubscribeExit = window.piLing.onTerminalExit((event) => {
      if (disposed || event.sessionId !== sessionIdRef.current) return;
      emitMeta({
        status: "exited",
        cwd: metaRef.current.cwd,
        shell: metaRef.current.shell,
        exitCode: event.exitCode,
      });
    });

    void window.piLing
      .terminalStart({
        cwd: props.root,
        cols: terminal.cols,
        rows: terminal.rows,
      })
      .then((result) => {
        if (disposed) return;
        sessionIdRef.current = result.sessionId;
        emitMeta({
          status: "ready",
          cwd: result.cwd,
          shell: result.shell,
          exitCode: null,
        });
        window.requestAnimationFrame(() => {
          try {
            fit.fit();
            sendResize();
            if (props.active && props.visible) terminal.focus();
          } catch {
            // The panel may still be transitioning its width.
          }
        });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        const message =
          error instanceof Error ? error.message : "terminal error";
        emitMeta({
          status: "error",
          cwd: "",
          shell: "",
          exitCode: null,
        });
        terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
      });

    return () => {
      disposed = true;
      inputDisposable.dispose();
      resizeObserver.disconnect();
      unsubscribeOutput();
      unsubscribeExit();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void window.piLing.terminalKill(sessionId);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      sessionIdRef.current = null;
    };
  }, [props.root, refreshTree]);

  useEffect(() => {
    if (!props.active || !props.visible) return;
    window.requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        terminalRef.current?.focus();
      } catch {
        // The panel may still be transitioning its width.
      }
    });
  }, [props.active, props.visible]);

  return (
    <div
      ref={hostRef}
      className={`terminal-host ${props.visible ? "is-visible" : "is-hidden"}`}
      onClick={() => terminalRef.current?.focus()}
    />
  );
}
