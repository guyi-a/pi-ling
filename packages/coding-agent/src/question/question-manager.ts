import type { AskUserAnswer, AskUserQuestion } from "@pi-ling/contracts";

export interface QuestionRequest {
  runId: string;
  turnId: string;
  callId: string;
  questions: AskUserQuestion[];
}

interface PendingQuestion {
  request: QuestionRequest;
  promise: Promise<AskUserAnswer[]>;
  resolve: (answers: AskUserAnswer[]) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
}

export class QuestionManager {
  readonly #pending = new Map<string, PendingQuestion>();
  readonly #onRequest: (request: QuestionRequest) => void | Promise<void>;

  constructor(onRequest: (request: QuestionRequest) => void | Promise<void>) {
    this.#onRequest = onRequest;
  }

  wait(
    identity: { runId: string; turnId: string },
    callId: string,
    questions: AskUserQuestion[],
    signal: AbortSignal,
  ): Promise<AskUserAnswer[]> {
    if (questions.length === 0) {
      return Promise.reject(
        new Error("ask_user requires at least one question"),
      );
    }

    const existing = this.#pending.get(callId);
    if (existing) {
      this.#attachSignal(existing, signal);
      return existing.promise;
    }

    const request: QuestionRequest = {
      ...identity,
      callId,
      questions: structuredClone(questions),
    };

    let resolve!: (answers: AskUserAnswer[]) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<AskUserAnswer[]>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const pending: PendingQuestion = {
      request,
      promise,
      resolve,
      reject,
    };
    this.#pending.set(callId, pending);
    this.#attachSignal(pending, signal);
    void Promise.resolve(this.#onRequest(request)).catch((error: unknown) => {
      this.#reject(
        callId,
        error instanceof Error
          ? error
          : new Error("Question persistence failed"),
      );
    });
    return promise;
  }

  restore(request: QuestionRequest): void {
    if (this.#pending.has(request.callId)) {
      return;
    }
    let resolve!: (answers: AskUserAnswer[]) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<AskUserAnswer[]>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    this.#pending.set(request.callId, {
      request: structuredClone(request),
      promise,
      resolve,
      reject,
    });
  }

  resolve(callId: string, answers: AskUserAnswer[]): boolean {
    const pending = this.#pending.get(callId);
    if (!pending) {
      return false;
    }
    this.#settle(callId, answers);
    return true;
  }

  list(): QuestionRequest[] {
    return [...this.#pending.values()].map(({ request }) =>
      structuredClone(request),
    );
  }

  cancelAll(reason = "ask_user was aborted before the user answered"): void {
    for (const callId of [...this.#pending.keys()]) {
      this.#reject(callId, new Error(reason));
    }
  }

  #attachSignal(pending: PendingQuestion, signal: AbortSignal): void {
    if (pending.signal === signal) {
      return;
    }
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
    const abort = () =>
      this.#reject(
        pending.request.callId,
        new Error("ask_user was aborted before the user answered"),
      );
    pending.signal = signal;
    pending.abort = abort;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
    }
  }

  #settle(callId: string, answers: AskUserAnswer[]): void {
    const pending = this.#pending.get(callId);
    if (!pending) {
      return;
    }
    this.#pending.delete(callId);
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
    pending.resolve(structuredClone(answers));
  }

  #reject(callId: string, error: Error): void {
    const pending = this.#pending.get(callId);
    if (!pending) {
      return;
    }
    this.#pending.delete(callId);
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
    pending.reject(error);
  }
}
