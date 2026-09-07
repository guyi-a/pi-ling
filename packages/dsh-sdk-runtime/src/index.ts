import { dirname, resolve } from "node:path";

import {
  DeepSeekHarness,
  type HarnessNotification,
} from "@deepseek-ai/dsh-sdk-client";
import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimePermissionDecision,
  RuntimeSessionHandle,
  RuntimeSessionOptions,
} from "@pi-ling/runtime-contracts";

export interface DshSdkRuntimeOptions {
  dshBin: string;
  dshHome: string;
  cwd: string;
  processCwd?: string;
  provider?: string;
  model?: string;
  nodeImportHook?: string;
  env?: NodeJS.ProcessEnv;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function textContent(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((block) => {
      const item = record(block);
      return item?.["type"] === "text" && typeof item["text"] === "string"
        ? [item["text"]]
        : [];
    })
    .join("");
}

export function mapSdkSessionEvent(
  sessionId: string,
  runId: string,
  value: unknown,
): RuntimeEvent[] {
  const executionGroupId = `${runId}:exec`;
  const event = record(value);
  const data = record(event?.["data"]);
  if (!event || !data || typeof event["type"] !== "string") return [];
  if (event["type"] === "assistant/message") {
    const message = record(data["message"]);
    const content = Array.isArray(message?.["content"])
      ? message["content"]
      : [];
    const output: RuntimeEvent[] = [];
    for (const block of content) {
      const item = record(block);
      if (item?.["type"] === "reasoning" && typeof item["text"] === "string") {
        output.push({
          type: "assistant_thought",
          sessionId,
          runId,
          executionGroupId,
          delta: item["text"],
        });
      } else if (
        item?.["type"] === "text" &&
        typeof item["text"] === "string"
      ) {
        output.push({
          type: "assistant_text",
          sessionId,
          runId,
          executionGroupId,
          delta: item["text"],
        });
      }
    }
    const usage = record(data["usage"]);
    if (
      usage &&
      typeof usage["inputTokens"] === "number" &&
      typeof usage["outputTokens"] === "number"
    ) {
      output.push({
        type: "context_usage",
        sessionId,
        runId,
        used: usage["inputTokens"] + usage["outputTokens"],
        size: 0,
      });
    }
    return output;
  }
  if (event["type"] === "tool/call") {
    const callId = String(data["callId"] ?? "");
    const name = String(data["name"] ?? "DSH tool");
    let input: unknown = data["arguments"];
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {}
    }
    return [
      {
        type: "tool",
        sessionId,
        runId,
        executionGroupId,
        callId,
        title: name,
        status: "running",
        input,
      },
    ];
  }
  if (event["type"] === "tool/result") {
    const message = record(data["message"]);
    const wrapper = Array.isArray(message?.["content"])
      ? record(message["content"][0])
      : undefined;
    return [
      {
        type: "tool",
        sessionId,
        runId,
        executionGroupId,
        callId: String(wrapper?.["toolCallId"] ?? ""),
        title: "DSH tool",
        status: data["error"] ? "failed" : "completed",
        output: textContent(wrapper?.["content"]),
      },
    ];
  }
  return [];
}

export class DshSdkRuntimeAdapter implements RuntimeAdapter {
  readonly kind = "dsh" as const;
  readonly capabilities: RuntimeCapabilities = {
    modelSwitching: false,
    partialStreaming: false,
    toolApproval: false,
    mcp: false,
    hooks: false,
    sandbox: true,
    subagents: true,
    resume: false,
    fork: false,
    fileCheckpoint: false,
  };
  readonly #options: DshSdkRuntimeOptions;
  readonly #listeners = new Set<RuntimeEventListener>();
  readonly #sessions = new Set<string>();
  readonly #activeRuns = new Map<string, string>();
  readonly #cancelledRuns = new Set<string>();
  #harness: DeepSeekHarness | undefined;

  constructor(options: DshSdkRuntimeOptions) {
    this.#options = options;
  }

  async initialize(): Promise<void> {
    await this.#ensureHarness().start();
  }

  async createSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    await this.initialize();
    this.#sessions.add(options.sessionId);
    return {
      sessionId: options.sessionId,
      externalSessionId: options.sessionId,
    };
  }

  async resumeSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    await this.initialize();
    const sessionId = options.externalSessionId ?? options.sessionId;
    this.#sessions.add(sessionId);
    return { sessionId: options.sessionId, externalSessionId: sessionId };
  }

  async send(
    sessionId: string,
    runId: string,
    prompt: string,
  ): Promise<void> {
    if (!this.#sessions.has(sessionId)) {
      throw new Error(`DSH SDK session not found: ${sessionId}`);
    }
    if (this.#activeRuns.has(sessionId)) {
      throw new Error(`DSH SDK session is already running: ${sessionId}`);
    }
    this.#activeRuns.set(sessionId, runId);
    await this.#emit({ type: "run_start", sessionId, runId });
    let delivery = Promise.resolve();
    try {
      const result = await this.#ensureHarness().session(sessionId).run(
        prompt,
        {
          onNotification: (notification) => {
            delivery = delivery.then(() =>
              this.#handleNotification(sessionId, runId, notification),
            );
          },
        },
      );
      await delivery;
      await this.#emit({
        type: "run_end",
        sessionId,
        runId,
        status: result.events.some(
          (event) =>
            event.type === "turn/end" && event.data.reason.kind === "error",
        )
          ? "error"
          : "completed",
      });
    } catch (error) {
      const cancelled = this.#cancelledRuns.delete(runId);
      await this.#emit({
        type: "run_end",
        sessionId,
        runId,
        status: cancelled ? "cancelled" : "error",
        ...(!cancelled
          ? { error: error instanceof Error ? error.message : String(error) }
          : {}),
      });
      if (!cancelled) throw error;
    } finally {
      this.#activeRuns.delete(sessionId);
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const runId = this.#activeRuns.get(sessionId);
    if (!runId || !this.#harness) return;
    this.#cancelledRuns.add(runId);
    const harness = this.#harness;
    this.#harness = undefined;
    await harness.close();
  }

  resolvePermission(
    _decision: RuntimePermissionDecision,
  ): Promise<boolean> {
    return Promise.resolve(false);
  }

  closeSession(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
    return Promise.resolve();
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    const harness = this.#harness;
    this.#harness = undefined;
    if (harness) await harness.close();
    this.#sessions.clear();
    this.#activeRuns.clear();
    this.#listeners.clear();
  }

  #ensureHarness(): DeepSeekHarness {
    if (this.#harness) return this.#harness;
    const nodeOptions = [
      this.#options.env?.["NODE_OPTIONS"],
      this.#options.nodeImportHook
        ? `--import=${this.#options.nodeImportHook}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    this.#harness = new DeepSeekHarness({
      dshBin: this.#options.dshBin,
      profile: "sdk",
      dshHome: this.#options.dshHome,
      cwd: this.#options.cwd,
      processCwd: this.#options.processCwd ?? this.#options.cwd,
      provider: this.#options.provider ?? "deepseek-official",
      model: this.#options.model ?? "deepseek-v4-flash",
      env: {
        ...process.env,
        ...this.#options.env,
        ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}),
        PI_LING_DSH_MODULE_ROOT: resolve(
          dirname(this.#options.dshBin),
          "../node_modules",
        ),
      },
      initializeTimeoutMs: 30_000,
    });
    return this.#harness;
  }

  async #handleNotification(
    sessionId: string,
    runId: string,
    notification: HarnessNotification,
  ): Promise<void> {
    if (
      notification.method !== "session.event" ||
      notification.params["sessionId"] !== sessionId
    ) {
      return;
    }
    for (const event of mapSdkSessionEvent(
      sessionId,
      runId,
      notification.params["event"],
    )) {
      await this.#emit(event);
    }
  }

  async #emit(event: RuntimeEvent): Promise<void> {
    for (const listener of this.#listeners) await listener(event);
  }
}
