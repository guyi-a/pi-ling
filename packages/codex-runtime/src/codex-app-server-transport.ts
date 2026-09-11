import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type {
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./codex-app-server-types.js";

export interface CodexAppServerTransportOptions {
  codexBin: string;
  args?: string[];
  env: Record<string, string>;
  cwd?: string;
  initializeTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

type NotificationListener = (notification: JsonRpcNotification) => void;
type ServerRequestHandler = (
  request: JsonRpcRequest,
) => Promise<unknown> | unknown;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexAppServerTransport {
  readonly #options: CodexAppServerTransportOptions;
  readonly #pending = new Map<JsonRpcId, PendingRequest>();
  readonly #notifications = new Set<NotificationListener>();
  readonly #serverRequests = new Set<ServerRequestHandler>();
  #child: ChildProcessWithoutNullStreams | undefined;
  #nextRequestId = 1;
  #stderr = "";
  #disposed = false;

  constructor(options: CodexAppServerTransportOptions) {
    this.#options = options;
  }

  get diagnostics(): string {
    return this.#stderr;
  }

  onNotification(listener: NotificationListener): () => void {
    this.#notifications.add(listener);
    return () => this.#notifications.delete(listener);
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    this.#serverRequests.add(handler);
    return () => this.#serverRequests.delete(handler);
  }

  start(): Promise<void> {
    if (this.#child) return Promise.resolve();
    if (this.#disposed) {
      return Promise.reject(new Error("Codex app-server transport disposed"));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.#options.codexBin,
        this.#options.args ?? ["app-server", "--stdio"],
        {
          ...(this.#options.cwd ? { cwd: this.#options.cwd } : {}),
          env: this.#options.env,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      this.#child = child;
      let settled = false;
      const failStart = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      child.once("error", failStart);
      child.once("spawn", () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        this.#stderr = (this.#stderr + chunk.toString("utf8")).slice(-32_768);
      });
      const lines = createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      });
      lines.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          this.#handleMessage(JSON.parse(trimmed) as JsonRpcMessage);
        } catch (error) {
          this.#stderr = (
            this.#stderr +
            `\nInvalid app-server JSON: ${String(error)}\n${trimmed}`
          ).slice(-32_768);
        }
      });
      child.once("exit", (code) => {
        this.#child = undefined;
        const message =
          this.#stderr ||
          `Codex app-server exited${code === null ? "" : ` (${code})`}`;
        for (const pending of this.#pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error(message));
        }
        this.#pending.clear();
      });
    });
  }

  request<T>(
    method: string,
    params: unknown,
    timeoutMs = this.#options.initializeTimeoutMs ?? 30_000,
  ): Promise<T> {
    const id = this.#nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      });
      try {
        this.#write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.#write({
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.#write({ id, result });
  }

  respondError(id: JsonRpcId, error: Error): void {
    this.#write({
      id,
      error: { code: -32_000, message: error.message },
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const child = this.#child;
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(
        () => resolve(false),
        this.#options.shutdownTimeoutMs ?? 3_000,
      );
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (exited) return;
    if (process.platform === "win32" && child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        killer.once("exit", () => resolve());
        killer.once("error", () => resolve());
        setTimeout(resolve, 5_000);
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      return;
    }
    child.kill("SIGTERM");
  }

  #write(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    const child = this.#child;
    if (!child?.stdin.writable) {
      throw new Error("Codex app-server is not running");
    }
    child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
  }

  #handleMessage(message: JsonRpcMessage): void {
    if ("id" in message && !("method" in message)) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (!("method" in message)) return;
    if ("id" in message) {
      const handler = [...this.#serverRequests][0];
      if (!handler) {
        this.respondError(
          message.id,
          new Error(`Unhandled app-server request: ${message.method}`),
        );
        return;
      }
      void Promise.resolve(handler(message)).then(
        (result) => this.respond(message.id, result),
        (error) =>
          this.respondError(
            message.id,
            error instanceof Error ? error : new Error(String(error)),
          ),
      );
      return;
    }
    for (const listener of this.#notifications) listener(message);
  }
}
