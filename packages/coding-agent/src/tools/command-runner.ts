import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export class CommandRunner {
  constructor(
    readonly cwd: string,
    readonly timeoutMs = 120_000,
    readonly maxOutputBytes = 1024 * 1024,
  ) {}

  run(command: string, signal: AbortSignal): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const child = spawn(command, {
        cwd: this.cwd,
        shell: true,
        windowsHide: true,
        env: process.env,
      });
      const terminate = () => {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          }).unref();
        } else {
          child.kill("SIGTERM");
        }
      };

      const append = (target: "stdout" | "stderr", chunk: Buffer) => {
        const remaining = this.maxOutputBytes - outputBytes;
        if (remaining <= 0) {
          truncated = true;
          return;
        }
        const value = chunk.subarray(0, remaining).toString("utf8");
        outputBytes += Buffer.byteLength(value);
        if (target === "stdout") {
          stdout += value;
        } else {
          stderr += value;
        }
        if (chunk.length > remaining) {
          truncated = true;
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

      const abort = () => {
        if (settled) {
          return;
        }
        settled = true;
        terminate();
        const error = new Error("Command aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener("abort", abort, { once: true });

      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, this.timeoutMs);

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        reject(error);
      });
      child.on("close", (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        resolve({
          exitCode,
          stdout,
          stderr,
          truncated,
          timedOut,
        });
      });
    });
  }
}
