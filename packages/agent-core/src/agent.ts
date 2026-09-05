import { randomUUID } from "node:crypto";

import type {
  Message,
  Model,
  ThinkingLevel,
  UserMessage,
} from "@pi-ling/ai";

import { runAgentLoop } from "./agent-loop.js";
import type {
  AgentEvent,
  AgentEventListener,
  AgentOptions,
  AgentState,
  AgentTool,
  BeforeToolCall,
} from "./types.js";

interface MutableAgentState {
  systemPrompt: string;
  model: Model;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool[];
  messages: Message[];
  isStreaming: boolean;
  errorMessage: string | undefined;
}

export class Agent {
  readonly #state: MutableAgentState;
  readonly #streamFn: AgentOptions["streamFn"];
  readonly #beforeToolCall: BeforeToolCall | undefined;
  readonly #maxTurns: number;
  readonly #listeners = new Set<AgentEventListener>();
  #active:
    | {
        controller: AbortController;
        promise: Promise<void>;
      }
    | undefined;

  constructor(options: AgentOptions) {
    this.#state = {
      systemPrompt: options.initialState.systemPrompt ?? "",
      model: options.initialState.model,
      thinkingLevel: options.initialState.thinkingLevel ?? "off",
      tools: [...(options.initialState.tools ?? [])],
      messages: [...(options.initialState.messages ?? [])],
      isStreaming: false,
      errorMessage: undefined,
    };
    this.#streamFn = options.streamFn;
    this.#beforeToolCall = options.beforeToolCall;
    this.#maxTurns = options.maxTurns ?? 20;
  }

  get state(): AgentState {
    return this.#state;
  }

  subscribe(listener: AgentEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setModel(model: Model): void {
    if (this.#state.isStreaming) {
      throw new Error("Cannot change model while the agent is running");
    }
    this.#state.model = model;
  }

  setTools(tools: readonly AgentTool[]): void {
    if (this.#state.isStreaming) {
      throw new Error("Cannot change tools while the agent is running");
    }
    this.#state.tools = [...tools];
  }

  async prompt(
    text: string,
    options: { runId?: string } = {},
  ): Promise<void> {
    if (this.#active) {
      throw new Error("Agent is already processing a prompt");
    }
    const value = text.trim();
    if (!value) {
      throw new Error("Prompt cannot be empty");
    }

    const prompt: UserMessage = {
      role: "user",
      content: [{ type: "text", text: value }],
      timestamp: Date.now(),
    };
    const controller = new AbortController();
    const runId = options.runId ?? randomUUID();
    this.#state.isStreaming = true;
    this.#state.errorMessage = undefined;

    const promise = this.#run(prompt, controller, runId).finally(() => {
      this.#state.isStreaming = false;
      this.#active = undefined;
    });
    this.#active = { controller, promise };
    await promise;
  }

  abort(): void {
    this.#active?.controller.abort();
  }

  waitForIdle(): Promise<void> {
    return this.#active?.promise ?? Promise.resolve();
  }

  reset(): void {
    if (this.#active) {
      throw new Error("Cannot reset a running agent");
    }
    this.#state.messages = [];
    this.#state.errorMessage = undefined;
  }

  async #run(
    prompt: UserMessage,
    controller: AbortController,
    runId: string,
  ): Promise<void> {
    await runAgentLoop({
      runId,
      context: {
        systemPrompt: this.#state.systemPrompt,
        messages: this.#state.messages,
        tools: this.#state.tools,
      },
      model: this.#state.model,
      reasoning: this.#state.thinkingLevel,
      tools: this.#state.tools,
      prompt,
      signal: controller.signal,
      streamFn: this.#streamFn,
      ...(this.#beforeToolCall
        ? { beforeToolCall: this.#beforeToolCall }
        : {}),
      maxTurns: this.#maxTurns,
      emit: async (event) => {
        this.#reduce(event);
        for (const listener of this.#listeners) {
          await listener(event, controller.signal);
        }
      },
    });
  }

  #reduce(event: AgentEvent): void {
    if (event.type === "message_end") {
      this.#state.messages.push(event.message);
      if (
        event.message.role === "assistant" &&
        event.message.errorMessage
      ) {
        this.#state.errorMessage = event.message.errorMessage;
      }
    }
  }
}
