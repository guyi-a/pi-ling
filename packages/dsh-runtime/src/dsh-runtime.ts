import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { Readable, Writable } from "node:stream";

import {
  client as createAcpClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type RequestPermissionResponse,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimePermissionDecision,
  RuntimeSessionHandle,
  RuntimeSessionOptions,
  RuntimeToolStatus,
} from "@pi-ling/runtime-contracts";

export interface DshRuntimeOptions {
  dshBin?: string;
  dshHome: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  initializeTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

interface PendingPermission {
  resolve: (response: RequestPermissionResponse) => void;
  options: Array<{ optionId: string; kind: string }>;
}

const ALLOWED_ENV = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "PATHEXT",
  "COMSPEC",
] as const;

function childEnvironment(options: DshRuntimeOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    DSH_HOME: options.dshHome,
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...options.env,
  };
}

function textContent(content: unknown): string {
  return typeof content === "object" &&
    content !== null &&
    Reflect.get(content, "type") === "text" &&
    typeof Reflect.get(content, "text") === "string"
    ? (Reflect.get(content, "text") as string)
    : "";
}

function toolStatus(status: unknown): RuntimeToolStatus {
  if (status === "in_progress") return "running";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "requested";
}

export class DshRuntimeAdapter implements RuntimeAdapter {
  readonly kind = "dsh" as const;
  readonly capabilities: RuntimeCapabilities = {
    modelSwitching: true,
    partialStreaming: true,
    toolApproval: true,
    mcp: true,
    hooks: false,
    sandbox: true,
    subagents: true,
    resume: true,
    fork: false,
    fileCheckpoint: false,
  };
  readonly #options: DshRuntimeOptions;
  readonly #listeners = new Set<RuntimeEventListener>();
  readonly #sessions = new Map<string, string>();
  readonly #runByRemoteSession = new Map<string, string>();
  readonly #permissions = new Map<string, PendingPermission>();
  #child: ChildProcessWithoutNullStreams | undefined;
  #connection: ClientConnection | undefined;
  #initializing: Promise<void> | undefined;
  #stderr = "";
  #disposed = false;

  constructor(options: DshRuntimeOptions) {
    this.#options = options;
  }

  initialize(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error("DSH runtime disposed"));
    return (this.#initializing ??= this.#start().catch((error: unknown) => {
      this.#initializing = undefined;
      this.#connection?.close(error);
      this.#connection = undefined;
      throw error;
    }));
  }

  async createSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    const agent = await this.#agent();
    const response = await agent.request(methods.agent.session.new, {
      cwd: options.workspaceRoot,
      mcpServers: [],
    });
    this.#sessions.set(options.sessionId, response.sessionId);
    return {
      sessionId: options.sessionId,
      externalSessionId: response.sessionId,
    };
  }

  async resumeSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    if (!options.externalSessionId) return this.createSession(options);
    const agent = await this.#agent();
    await agent.request(methods.agent.session.resume, {
      sessionId: options.externalSessionId,
      cwd: options.workspaceRoot,
      mcpServers: [],
    });
    this.#sessions.set(options.sessionId, options.externalSessionId);
    return {
      sessionId: options.sessionId,
      externalSessionId: options.externalSessionId,
    };
  }

  async send(
    sessionId: string,
    runId: string,
    prompt: string,
  ): Promise<void> {
    const remoteSessionId = this.#requireRemoteSession(sessionId);
    const agent = await this.#agent();
    this.#runByRemoteSession.set(remoteSessionId, runId);
    await this.#emit({ type: "run_start", sessionId, runId });
    try {
      const response = await agent.request(methods.agent.session.prompt, {
        sessionId: remoteSessionId,
        prompt: [{ type: "text", text: prompt }],
      });
      await this.#emit({
        type: "run_end",
        sessionId,
        runId,
        status:
          response.stopReason === "cancelled"
            ? "cancelled"
            : response.stopReason === "end_turn"
              ? "completed"
              : "error",
        ...(response.stopReason !== "end_turn" &&
        response.stopReason !== "cancelled"
          ? { error: `DSH stopped: ${response.stopReason}` }
          : {}),
      });
    } catch (error) {
      await this.#emit({
        type: "run_end",
        sessionId,
        runId,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.#runByRemoteSession.delete(remoteSessionId);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const remoteSessionId = this.#sessions.get(sessionId);
    if (!remoteSessionId || !this.#connection) return;
    await this.#connection.agent.notify(methods.agent.session.cancel, {
      sessionId: remoteSessionId,
    });
  }

  async resolvePermission(
    decision: RuntimePermissionDecision,
  ): Promise<boolean> {
    const pending = this.#permissions.get(decision.permissionId);
    if (!pending) return false;
    this.#permissions.delete(decision.permissionId);
    const selected = pending.options.find(
      (option) => option.optionId === decision.optionId,
    );
    pending.resolve(
      !decision.cancelled && selected
        ? {
            outcome: {
              outcome: "selected",
              optionId: selected.optionId,
            },
          }
        : { outcome: { outcome: "cancelled" } },
    );
    return true;
  }

  async closeSession(sessionId: string): Promise<void> {
    const remoteSessionId = this.#sessions.get(sessionId);
    if (!remoteSessionId || !this.#connection) return;
    await this.#connection.agent.request(methods.agent.session.close, {
      sessionId: remoteSessionId,
    });
    this.#sessions.delete(sessionId);
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const permission of this.#permissions.values()) {
      permission.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.#permissions.clear();
    if (this.#connection) {
      for (const sessionId of this.#sessions.values()) {
        await this.#connection.agent
          .request(methods.agent.session.close, { sessionId })
          .catch(() => {});
      }
      this.#connection.close();
    }
    const child = this.#child;
    if (child && child.exitCode === null) {
      child.stdin.end();
      if (!(await this.#waitForExit(child, this.#options.shutdownTimeoutMs ?? 3000))) {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          }).unref();
        } else {
          child.kill("SIGTERM");
        }
        await this.#waitForExit(child, 3000);
      }
    }
    this.#sessions.clear();
    this.#listeners.clear();
  }

  get diagnostics(): string {
    return this.#stderr;
  }

  async #start(): Promise<void> {
    const command = this.#options.command ?? process.execPath;
    const args =
      this.#options.args ??
      (this.#options.dshBin
        ? [
            ...(process.platform === "win32"
              ? [
                  "--import",
                  new URL("./fs-ext-hook.js", import.meta.url).href,
                ]
              : []),
            this.#options.dshBin,
            "--profile",
            "acp",
          ]
        : []);
    if (args.length === 0) throw new Error("A DSH executable is required");
    const env = childEnvironment(this.#options);
    if (this.#options.dshBin) {
      env["PI_LING_DSH_MODULE_ROOT"] = resolve(
        dirname(this.#options.dshBin),
        "../node_modules",
      );
    }
    const child = spawn(command, args, {
      ...(this.#options.cwd ? { cwd: this.#options.cwd } : {}),
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString("utf8")).slice(-32_768);
    });
    child.once("exit", (exitCode) => {
      if (!this.#disposed) {
        void this.#emit({
          type: "runtime_error",
          error: this.#stderr || "DSH process exited unexpectedly",
          ...(exitCode !== null ? { exitCode } : {}),
        });
      }
    });

    const clientApp = createAcpClientApp({ name: "pi-ling" })
      .onNotification(methods.client.session.update, ({ params }) => {
        void this.#handleUpdate(params.sessionId, params.update);
        return Promise.resolve();
      })
      .onRequest(methods.client.session.requestPermission, ({ params }) => {
        const runId =
          this.#runByRemoteSession.get(params.sessionId) ?? randomUUID();
        const permissionId = randomUUID();
        return new Promise<RequestPermissionResponse>((resolve) => {
          this.#permissions.set(permissionId, {
            resolve,
            options: params.options.map((option) => ({
              optionId: option.optionId,
              kind: option.kind,
            })),
          });
          void this.#emit({
            type: "permission",
            sessionId: this.#productSession(params.sessionId),
            runId,
            permissionId,
            callId: params.toolCall.toolCallId,
            title: params.toolCall.title ?? "DSH permission",
            ...(params.toolCall.kind
              ? { toolKind: params.toolCall.kind }
              : {}),
            ...(params.toolCall.rawInput !== undefined
              ? { input: params.toolCall.rawInput }
              : {}),
            options: params.options.map((option) => ({
              optionId: option.optionId,
              label: option.name,
              kind: option.kind,
            })),
          });
        });
      });
    const connection = clientApp.connect(
      ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    this.#connection = connection;
    try {
      await this.#withTimeout(
        connection.agent.request(methods.agent.initialize, {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
        }),
        this.#options.initializeTimeoutMs ?? 30_000,
        "DSH ACP initialize timed out",
      );
    } catch (error) {
      throw new Error(
        `DSH ACP initialization failed${
          this.#stderr ? `\n${this.#stderr}` : ""
        }`,
        { cause: error },
      );
    }
  }

  async #handleUpdate(
    remoteSessionId: string,
    update: SessionUpdate,
  ): Promise<void> {
    const runId = this.#runByRemoteSession.get(remoteSessionId);
    if (!runId) return;
    const sessionId = this.#productSession(remoteSessionId);
    if (update.sessionUpdate === "agent_message_chunk") {
      const delta = textContent(update.content);
      if (delta) {
        await this.#emit({ type: "assistant_text", sessionId, runId, delta });
      }
    } else if (update.sessionUpdate === "agent_thought_chunk") {
      const delta = textContent(update.content);
      if (delta) {
        await this.#emit({
          type: "assistant_thought",
          sessionId,
          runId,
          delta,
        });
      }
    } else if (
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update"
    ) {
      await this.#emit({
        type: "tool",
        sessionId,
        runId,
        callId: update.toolCallId,
        title: update.title ?? update.name ?? "DSH tool",
        ...(update.kind ? { kind: update.kind } : {}),
        status: toolStatus(update.status),
        ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
        ...(update.rawOutput !== undefined
          ? {
              output:
                typeof update.rawOutput === "string"
                  ? update.rawOutput
                  : JSON.stringify(update.rawOutput),
            }
          : {}),
      });
    } else if (update.sessionUpdate === "usage_update") {
      await this.#emit({
        type: "usage",
        sessionId,
        runId,
        used: update.used,
        size: update.size,
      });
    }
  }

  async #agent() {
    await this.initialize();
    if (!this.#connection) throw new Error("DSH ACP connection unavailable");
    return this.#connection.agent;
  }

  #requireRemoteSession(sessionId: string): string {
    const remote = this.#sessions.get(sessionId);
    if (!remote) throw new Error(`DSH session not found: ${sessionId}`);
    return remote;
  }

  #productSession(remoteSessionId: string): string {
    for (const [productSessionId, remote] of this.#sessions) {
      if (remote === remoteSessionId) return productSessionId;
    }
    throw new Error(`Unknown DSH remote session: ${remoteSessionId}`);
  }

  async #emit(event: RuntimeEvent): Promise<void> {
    for (const listener of this.#listeners) await listener(event);
  }

  async #withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #waitForExit(
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ): Promise<boolean> {
    if (child.exitCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.removeListener("exit", exited);
        resolve(false);
      }, timeoutMs);
      const exited = () => {
        clearTimeout(timer);
        resolve(true);
      };
      child.once("exit", exited);
    });
  }
}
