import { execFile } from "node:child_process";
import { basename } from "node:path";

/**
 * Packaged desktop apps inherit a minimal PATH (especially on macOS via
 * launchd). Capture the user's login-shell PATH once so PTY sessions and
 * spawned runtimes can resolve node, pnpm, uv, etc.
 *
 * Adapted from LingCoWork's login-shell-env helper.
 */
export interface CaptureLoginShellEnvOptions {
  shell?: string;
  home?: string;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

const RC_SOURCE_BY_SHELL: Record<string, string> = {
  zsh: "source ~/.zshrc 2>/dev/null; ",
  bash: "source ~/.bashrc 2>/dev/null; ",
};

export function parseNullDelimitedEnv(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of output.split("\0")) {
    if (!entry) continue;
    const separator = entry.indexOf("=");
    if (separator === -1) continue;
    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return env;
}

function captureUnixLoginShellEnv(
  options: CaptureLoginShellEnvOptions,
): Promise<Record<string, string> | undefined> {
  const shell = options.shell ?? process.env.SHELL ?? "/bin/zsh";
  const rcSource = RC_SOURCE_BY_SHELL[basename(shell)] ?? "";
  const seedEnv: Record<string, string> = {
    HOME: options.home ?? process.env.HOME ?? "",
    USER: process.env.USER ?? "",
    SHELL: shell,
    TERM: "xterm",
  };

  return new Promise((resolve) => {
    execFile(
      shell,
      ["-l", "-c", `${rcSource}env -0`],
      { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, env: seedEnv },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        resolve(parseNullDelimitedEnv(stdout));
      },
    );
  });
}

function captureWindowsPathEnv(
  options: CaptureLoginShellEnvOptions,
): Promise<Record<string, string> | undefined> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
      ],
      { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const pathValue = stdout.trim();
        if (!pathValue) {
          resolve(undefined);
          return;
        }
        resolve({ PATH: pathValue, Path: pathValue });
      },
    );
  });
}

export function captureLoginShellEnv(
  options: CaptureLoginShellEnvOptions = {},
): Promise<Record<string, string> | undefined> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return captureWindowsPathEnv(options);
  }
  return captureUnixLoginShellEnv(options);
}

type CaptureFn = (
  options: CaptureLoginShellEnvOptions,
) => Promise<Record<string, string> | undefined>;

let cachedCapture: Promise<Record<string, string> | undefined> | undefined;

export interface ApplyLoginShellEnvFixOptions extends CaptureLoginShellEnvOptions {
  capture?: CaptureFn;
}

function mergePath(existing: string | undefined, captured: string): string {
  const seen = new Set(
    (existing ?? "")
      .split(process.platform === "win32" ? ";" : ":")
      .filter(Boolean),
  );
  const additions = captured
    .split(process.platform === "win32" ? ";" : ":")
    .filter((directory) => directory && !seen.has(directory));
  if (additions.length === 0) {
    return existing ?? captured;
  }
  return [existing, ...additions].filter(Boolean).join(
    process.platform === "win32" ? ";" : ":",
  );
}

export async function applyLoginShellEnvFix(
  env: NodeJS.ProcessEnv = process.env,
  options: ApplyLoginShellEnvFixOptions = {},
): Promise<void> {
  const capture = options.capture ?? captureLoginShellEnv;
  if (!cachedCapture) {
    cachedCapture = capture(options).catch(() => undefined);
  }

  const captured = await cachedCapture;
  if (!captured) return;

  if (captured.PATH) {
    env.PATH = mergePath(env.PATH, captured.PATH);
    if (process.platform === "win32") {
      env.Path = env.PATH;
    }
  }
}
