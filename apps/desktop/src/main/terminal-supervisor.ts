import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalStartRequest,
  TerminalStartResult,
} from "@pi-ling/contracts";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import type { WebContents } from "electron";

const TERMINAL_OUTPUT_CHANNEL = "terminal:output";
const TERMINAL_EXIT_CHANNEL = "terminal:exit";

const MAX_INPUT_BYTES = 64 * 1024;

type PtySession = {
  sessionId: string;
  cwd: string;
  shell: string;
  pty: IPty;
  exited: boolean;
};

export class TerminalSupervisor {
  private readonly sessions = new Map<number, Map<string, PtySession>>();
  private readonly cleanupAttached = new Set<number>();

  start(
    webContents: WebContents,
    request: TerminalStartRequest,
  ): TerminalStartResult {
    this.attachCleanup(webContents);
    const webContentsId = webContents.id;
    const cwd = request.cwd.trim();
    if (!cwd) {
      throw new Error("Terminal cwd is required");
    }

    const cols = clampTerminalDimension(request.cols, 20, 500);
    const rows = clampTerminalDimension(request.rows, 5, 200);
    const shell = resolveShell();
    const sessionId = createSessionId();

    const terminal = pty.spawn(shell.path, shell.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: terminalEnvironment(),
    });

    const session: PtySession = {
      sessionId,
      cwd,
      shell: shell.path,
      pty: terminal,
      exited: false,
    };
    this.getWebContentsSessions(webContentsId).set(sessionId, session);

    terminal.onData((data) => {
      if (webContents.isDestroyed()) return;
      const payload: TerminalOutputEvent = {
        sessionId,
        data: Buffer.from(data, "utf8"),
      };
      webContents.send(TERMINAL_OUTPUT_CHANNEL, payload);
    });

    terminal.onExit(({ exitCode }) => {
      session.exited = true;
      if (webContents.isDestroyed()) return;
      const payload: TerminalExitEvent = {
        sessionId,
        exitCode: exitCode ?? null,
      };
      webContents.send(TERMINAL_EXIT_CHANNEL, payload);
    });

    return { sessionId, cwd, shell: shell.path };
  }

  input(webContentsId: number, sessionId: string, data: Uint8Array): void {
    const session = this.requireSession(webContentsId, sessionId);
    if (session.exited) return;
    if (data.byteLength > MAX_INPUT_BYTES) {
      throw new Error("Terminal input exceeds size limit");
    }
    session.pty.write(Buffer.from(data));
  }

  resize(
    webContentsId: number,
    sessionId: string,
    cols: number,
    rows: number,
  ): void {
    const session = this.requireSession(webContentsId, sessionId);
    if (session.exited) return;
    session.pty.resize(
      clampTerminalDimension(cols, 20, 500),
      clampTerminalDimension(rows, 5, 200),
    );
  }

  kill(webContentsId: number, sessionId: string): void {
    const sessionMap = this.sessions.get(webContentsId);
    if (!sessionMap) return;
    const session = sessionMap.get(sessionId);
    if (!session) return;
    try {
      session.pty.kill();
    } catch {
      // The shell may already have exited.
    }
    sessionMap.delete(sessionId);
    if (sessionMap.size === 0) {
      this.sessions.delete(webContentsId);
    }
  }

  destroy(webContentsId: number): void {
    const sessionMap = this.sessions.get(webContentsId);
    if (!sessionMap) return;
    for (const session of sessionMap.values()) {
      try {
        session.pty.kill();
      } catch {
        // The shell may already have exited.
      }
    }
    this.sessions.delete(webContentsId);
    this.cleanupAttached.delete(webContentsId);
  }

  disposeAll(): void {
    for (const webContentsId of [...this.sessions.keys()]) {
      this.destroy(webContentsId);
    }
    this.cleanupAttached.clear();
  }

  private getWebContentsSessions(
    webContentsId: number,
  ): Map<string, PtySession> {
    let sessionMap = this.sessions.get(webContentsId);
    if (!sessionMap) {
      sessionMap = new Map();
      this.sessions.set(webContentsId, sessionMap);
    }
    return sessionMap;
  }

  private attachCleanup(webContents: WebContents): void {
    const webContentsId = webContents.id;
    if (this.cleanupAttached.has(webContentsId)) return;
    this.cleanupAttached.add(webContentsId);
    webContents.once("destroyed", () => {
      this.destroy(webContentsId);
    });
  }

  private requireSession(
    webContentsId: number,
    sessionId: string,
  ): PtySession {
    const session = this.sessions.get(webContentsId)?.get(sessionId);
    if (!session) {
      throw new Error("Terminal session not found");
    }
    return session;
  }
}

function createSessionId(): string {
  return `terminal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampTerminalDimension(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return minimum;
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return Math.floor(value);
}

function terminalEnvironment(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.PYTHONIOENCODING = "utf-8";
  env.PYTHONUTF8 = "1";
  env.LANG = "en_US.UTF-8";
  env.LC_ALL = "en_US.UTF-8";
  return env;
}

function resolveShell(): { path: string; args: string[] } {
  if (process.platform === "win32") {
    const shellPath = loginShellWindows();
    const lower = shellPath.toLowerCase();
    if (lower.includes("powershell") || lower.includes("pwsh")) {
      const prelude =
        "chcp 65001 > $null; " +
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
        "[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false); " +
        "$OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
        "$PSDefaultParameterValues['*:Encoding'] = 'utf8'; " +
        "Clear-Host";
      return { path: shellPath, args: ["-NoExit", "-Command", prelude] };
    }
    return { path: shellPath, args: ["/k", "chcp 65001 > nul"] };
  }

  const shellPath =
    process.env.SHELL?.trim() ||
    ["/bin/zsh", "/bin/bash", "/bin/sh"].find((candidate) =>
      existsSync(candidate),
    ) ||
    "/bin/sh";
  return { path: shellPath, args: ["-l"] };
}

function findExecutableOnPath(name: string): string | undefined {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  for (const directory of pathEnv.split(";")) {
    const trimmed = directory.trim();
    if (!trimmed) continue;
    const candidate = join(trimmed, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function loginShellWindows(): string {
  const candidates = [
    findExecutableOnPath("pwsh.exe"),
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "PowerShell", "7", "pwsh.exe")
      : undefined,
    process.env["ProgramFiles(x86)"]
      ? join(process.env["ProgramFiles(x86)"], "PowerShell", "7", "pwsh.exe")
      : undefined,
    findExecutableOnPath("powershell.exe"),
    join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const comspec = process.env.COMSPEC?.trim();
  if (comspec && existsSync(comspec)) return comspec;
  if (comspec) return comspec;
  return "cmd.exe";
}
