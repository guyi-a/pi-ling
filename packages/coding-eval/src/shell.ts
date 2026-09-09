import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { platform } from "node:os";

const MAX_COMMAND_OUTPUT = 64 * 1024;

let bashPath: string | null | undefined;

function resolveBashPath(): string | null {
  if (bashPath !== undefined) return bashPath;
  if (platform() === "win32") {
    const discovered: string[] = [];
    try {
      const output = execFileSync("where", ["bash"], {
        encoding: "utf8",
        windowsHide: true,
      });
      for (const line of output.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/\\Windows\\System32\\bash\.exe$/i.test(trimmed)) continue;
        discovered.push(trimmed);
      }
    } catch {
      // ignore
    }
    for (const candidate of [
      process.env["BASH_PATH"],
      "D:\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
      ...discovered,
    ]) {
      if (!candidate) continue;
      try {
        accessSync(candidate, constants.X_OK);
        bashPath = candidate;
        return bashPath;
      } catch {
        // try next
      }
    }
    bashPath = null;
    return bashPath;
  }
  bashPath = "bash";
  return bashPath;
}

function spawnShell(command: string, cwd: string): ChildProcess {
  const bash = resolveBashPath();
  if (bash) {
    return spawn(bash, ["-lc", command], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
  }
  return spawn(command, {
    cwd,
    shell: true,
    env: process.env,
    windowsHide: true,
  });
}

function killShell(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  child.kill("SIGTERM");
}

export async function runShell(
  name: string,
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{
  name: string;
  command: string;
  exit_code: number;
  duration_ms: number;
  timed_out?: boolean;
  stdout?: string;
  stderr?: string;
}> {
  const started = Date.now();
  if (!command.trim()) {
    return {
      name,
      command,
      exit_code: 0,
      duration_ms: 0,
    };
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let settled = false;

    const child = spawnShell(command, cwd);
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const remaining = MAX_COMMAND_OUTPUT - outputBytes;
      if (remaining <= 0) return;
      const slice = chunk.subarray(0, remaining).toString("utf8");
      outputBytes += Buffer.byteLength(slice);
      if (target === "stdout") stdout += slice;
      else stderr += slice;
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      killShell(child);
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        name,
        command,
        exit_code: -1,
        duration_ms: Date.now() - started,
        stderr: error.message,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        name,
        command,
        exit_code: timedOut ? -1 : code ?? -1,
        duration_ms: Date.now() - started,
        ...(timedOut ? { timed_out: true } : {}),
        ...(stdout ? { stdout } : {}),
        ...(stderr ? { stderr } : {}),
      });
    });
  });
}
