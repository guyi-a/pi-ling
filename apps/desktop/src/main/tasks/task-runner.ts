import { randomUUID } from "node:crypto";

import type { BackgroundTask, SubagentSpec } from "@pi-ling/contracts";
import type { SpawnedSubagent } from "@pi-ling/coding-agent";

import type { SessionStore } from "../session-store/session-store.js";

export type SubmitBackgroundSubagentInput = {
  parentSessionId: string;
  parentRunId: string;
  parentToolCallId: string;
  description: string;
  spec: SubagentSpec;
  execute(input: {
    signal: AbortSignal;
    onSpawned(child: SpawnedSubagent): Promise<void>;
  }): Promise<{ summary: string }>;
};

type QueuedSubagent = {
  taskId: string;
  input: SubmitBackgroundSubagentInput;
};

export type TaskRunnerOptions = {
  store: SessionStore;
  concurrency?: number;
  onUpdated(task: BackgroundTask): void;
  onTerminal(task: BackgroundTask): Promise<void>;
};

export class TaskRunner {
  readonly #store: SessionStore;
  readonly #concurrency: number;
  readonly #onUpdated: (task: BackgroundTask) => void;
  readonly #onTerminal: (task: BackgroundTask) => Promise<void>;
  readonly #queue: QueuedSubagent[] = [];
  readonly #running = new Map<string, AbortController>();
  readonly #activePromises = new Set<Promise<void>>();
  readonly #cancelled = new Set<string>();
  #shuttingDown = false;

  constructor(options: TaskRunnerOptions) {
    this.#store = options.store;
    this.#concurrency = options.concurrency ?? 3;
    this.#onUpdated = options.onUpdated;
    this.#onTerminal = options.onTerminal;
  }

  async start(): Promise<void> {
    const interrupted = this.#store.interruptActiveBackgroundTasks();
    for (const task of interrupted) {
      await this.#publishTerminal(task);
    }
  }

  async shutdown(): Promise<void> {
    this.#shuttingDown = true;
    this.#queue.length = 0;
    for (const controller of this.#running.values()) {
      controller.abort();
    }
    await Promise.allSettled([...this.#activePromises]);
    const interrupted = this.#store.interruptActiveBackgroundTasks();
    for (const task of interrupted) {
      await this.#publishTerminal(task);
    }
  }

  submitSubagent(input: SubmitBackgroundSubagentInput): BackgroundTask {
    const task = this.#store.createBackgroundTask({
      id: randomUUID(),
      parentSessionId: input.parentSessionId,
      parentRunId: input.parentRunId,
      parentToolCallId: input.parentToolCallId,
      description: input.description,
    });
    this.#queue.push({ taskId: task.id, input });
    this.#onUpdated(task);
    this.#drain();
    return task;
  }

  get(taskId: string): BackgroundTask | undefined {
    return this.#store.getBackgroundTask(taskId);
  }

  list(parentSessionId: string): BackgroundTask[] {
    return this.#store.listBackgroundTasksBySession(parentSessionId);
  }

  #drain(): void {
    while (this.#running.size < this.#concurrency && this.#queue.length > 0) {
      const work = this.#queue.shift();
      if (!work) return;
      const controller = new AbortController();
      this.#running.set(work.taskId, controller);
      const promise = this.#runSubagent(work, controller).finally(() => {
        this.#running.delete(work.taskId);
        this.#activePromises.delete(promise);
        this.#cancelled.delete(work.taskId);
        if (!this.#shuttingDown) {
          this.#drain();
        }
      });
      this.#activePromises.add(promise);
      void promise;
    }
  }

  async #runSubagent(
    work: QueuedSubagent,
    controller: AbortController,
  ): Promise<void> {
    try {
      const running = this.#store.updateBackgroundTask(work.taskId, {
        status: "running",
      });
      this.#onUpdated(running);
      const result = await work.input.execute({
        signal: controller.signal,
        onSpawned: async (child) => {
          const updated = this.#store.updateBackgroundTask(work.taskId, {
            childSessionId: child.childSessionId,
          });
          this.#onUpdated(updated);
        },
      });
      if (this.#cancelled.has(work.taskId)) {
        return;
      }
      const completed = this.#store.updateBackgroundTask(work.taskId, {
        status: "completed",
        summary: result.summary,
      });
      await this.#publishTerminal(completed);
    } catch (error) {
      if (this.#cancelled.has(work.taskId)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const status = this.#shuttingDown
        ? "interrupted"
        : controller.signal.aborted
          ? "cancelled"
          : "failed";
      const failed = this.#store.updateBackgroundTask(work.taskId, {
        status,
        error: message,
      });
      await this.#publishTerminal(failed);
    }
  }

  async #publishTerminal(task: BackgroundTask): Promise<void> {
    this.#onUpdated(task);
    await this.#onTerminal(task);
  }
}
