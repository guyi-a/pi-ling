import type {
  AssistantMessage,
  AssistantMessageEvent,
} from "./types.js";

export class EventStream<TEvent, TResult> implements AsyncIterable<TEvent> {
  readonly #queue: TEvent[] = [];
  readonly #waiters: Array<(value: IteratorResult<TEvent>) => void> = [];
  readonly #resultPromise: Promise<TResult>;
  readonly #isTerminal: (event: TEvent) => boolean;
  readonly #getResult: (event: TEvent) => TResult;
  #resolveResult!: (result: TResult) => void;
  #ended = false;

  constructor(
    isTerminal: (event: TEvent) => boolean,
    getResult: (event: TEvent) => TResult,
  ) {
    this.#isTerminal = isTerminal;
    this.#getResult = getResult;
    this.#resultPromise = new Promise((resolve) => {
      this.#resolveResult = resolve;
    });
  }

  push(event: TEvent): void {
    if (this.#ended) {
      return;
    }

    const terminal = this.#isTerminal(event);
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.#queue.push(event);
    }

    if (terminal) {
      this.#ended = true;
      this.#resolveResult(this.#getResult(event));
      while (this.#waiters.length > 0) {
        this.#waiters.shift()?.({ value: undefined, done: true });
      }
    }
  }

  result(): Promise<TResult> {
    return this.#resultPromise;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TEvent> {
    while (true) {
      const queued = this.#queue.shift();
      if (queued !== undefined) {
        yield queued;
        continue;
      }
      if (this.#ended) {
        return;
      }

      const next = await new Promise<IteratorResult<TEvent>>((resolve) => {
        this.#waiters.push(resolve);
      });
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}

export class AssistantMessageEventStream extends EventStream<
  AssistantMessageEvent,
  AssistantMessage
> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") {
          return event.message;
        }
        if (event.type === "error") {
          return event.error;
        }
        throw new Error("Non-terminal event cannot produce a result");
      },
    );
  }
}
