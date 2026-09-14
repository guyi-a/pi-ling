import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { useFilesStore } from "../files/store";
import {
  terminalSelectionAnchor,
  type TerminalSelectionAnchor,
} from "./terminal-selection";
import { createTerminalTheme } from "./terminal-theme";

export type TerminalStatus = "connecting" | "ready" | "exited" | "error";

export type TerminalMeta = {
  status: TerminalStatus;
  cwd: string;
  shell: string;
  exitCode: number | null;
};

/** 终端选区快照。`anchor` 是视口坐标，用于摆放「加入对话」按钮。 */
export interface TerminalSelection {
  text: string;
  anchor: TerminalSelectionAnchor;
}

export function TerminalInstance(props: {
  root: string;
  active: boolean;
  visible: boolean;
  onMeta: (meta: TerminalMeta) => void;
  /**
   * 终端选区变化时回调；无选区时为 null。
   * 终端内容由 xterm 自己渲染，没有可选的 DOM 文本，所以只能由这里上报。
   */
  onSelectionChange?: (selection: TerminalSelection | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  // 回调放 ref：挂载 effect 不应因父组件重渲染而重建终端
  const onSelectionChangeRef = useRef(props.onSelectionChange);
  onSelectionChangeRef.current = props.onSelectionChange;
  const metaRef = useRef<TerminalMeta>({
    status: "connecting",
    cwd: "",
    shell: "",
    exitCode: null,
  });
  const refreshTreeThrottled = useFilesStore(
    (state) => state.refreshTreeThrottled,
  );
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
        // 终端输出是高频环境信号 —— 用节流版，避免把用户操作的刷新窗口占满
        refreshTreeThrottled();
      }, delay);
    };

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily:
        'Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: createTerminalTheme(),
      /*
       * 让右键选词而不是粘贴。
       *
       * 说明：xterm **默认就支持左键拖选**（选区由它自己维护），所以这里不需要
       * 额外的「开启选择」开关。真正会让用户选不中的是：终端里跑着启用了
       * 鼠标上报的 TUI 程序（vim / htop 等）时，xterm 会把鼠标事件转给程序；
       * 此时按住 Shift 拖选可以强制选择 —— 这是 xterm 的行为，无需配置。
       * 唯一需要显式声明的是右键语义：默认右键是粘贴，本产品希望它选词。
       */
      rightClickSelectsWord: true,
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

    /*
     * 终端里的「加入对话」。
     *
     * 终端没有可选的 DOM 文本（内容由 xterm 自己渲染），所以选区必须走
     * `terminal.getSelection()`；坐标则用 xterm 的行列 API 换算成像素，
     * 不能靠 window.getSelection()。
     */
    const selectionDisposable = terminal.onSelectionChange(() => {
      if (disposed) return;
      const text = terminal.getSelection();
      if (!text.trim()) {
        onSelectionChangeRef.current?.(null);
        return;
      }
      const position = terminal.getSelectionPosition();
      const hostRect = host.getBoundingClientRect();
      if (!position) {
        onSelectionChangeRef.current?.(null);
        return;
      }
      const anchor = terminalSelectionAnchor({
        end: position.end,
        viewportY: terminal.buffer.active.viewportY,
        rows: terminal.rows,
        cols: terminal.cols,
        hostRect,
      });
      if (!anchor) {
        // 选区末端滚出了可视区，或容器还没测量出尺寸
        onSelectionChangeRef.current?.(null);
        return;
      }
      onSelectionChangeRef.current?.({ text, anchor });
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
      selectionDisposable.dispose();
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
  }, [props.root, refreshTreeThrottled]);

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
