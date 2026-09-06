import type {
  StreamFrame,
  StreamFrameEnvelope,
} from "@pi-ling/contracts";

export interface StreamFrameInput {
  sessionId: string;
  runId: string;
  emittedAt: number;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  frame: StreamFrame;
}

interface BufferedRun {
  nextSeq: number;
  frames: StreamFrameEnvelope[];
  pending: StreamFrameInput | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  bytes: number;
}

function runKey(sessionId: string, runId: string): string {
  return `${sessionId}\0${runId}`;
}

function canMerge(left: StreamFrameInput, right: StreamFrameInput): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.runId === right.runId &&
    left.turnId === right.turnId &&
    left.messageId === right.messageId &&
    left.toolCallId === right.toolCallId &&
    left.frame.kind === right.frame.kind &&
    "delta" in left.frame &&
    "delta" in right.frame
  );
}

export class RunMessageBuffer {
  readonly #runs = new Map<string, BufferedRun>();
  readonly #onFrame: (frame: StreamFrameEnvelope) => void;
  readonly #mergeWindowMs: number;
  readonly #maxBytesPerRun: number;

  constructor(
    onFrame: (frame: StreamFrameEnvelope) => void,
    options: { mergeWindowMs?: number; maxBytesPerRun?: number } = {},
  ) {
    this.#onFrame = onFrame;
    this.#mergeWindowMs = options.mergeWindowMs ?? 16;
    this.#maxBytesPerRun = options.maxBytesPerRun ?? 1_048_576;
  }

  ingest(frame: StreamFrameInput): void {
    const key = runKey(frame.sessionId, frame.runId);
    const run = this.#runs.get(key) ?? {
      nextSeq: 1,
      frames: [],
      pending: undefined,
      timer: undefined,
      bytes: 0,
    };
    this.#runs.set(key, run);
    if (run.pending && canMerge(run.pending, frame)) {
      const left = run.pending.frame;
      const right = frame.frame;
      if ("delta" in left && "delta" in right) {
        run.pending = {
          ...run.pending,
          emittedAt: frame.emittedAt,
          frame: { ...left, delta: left.delta + right.delta } as StreamFrame,
        };
      }
      return;
    }
    this.#flushPending(run);
    run.pending = frame;
    run.timer = setTimeout(() => {
      run.timer = undefined;
      this.#flushPending(run);
    }, this.#mergeWindowMs);
  }

  snapshot(sessionId: string): StreamFrameEnvelope[] {
    const output: StreamFrameEnvelope[] = [];
    for (const [key, run] of this.#runs) {
      if (!key.startsWith(`${sessionId}\0`)) continue;
      this.#flushPending(run);
      output.push(...run.frames);
    }
    return output.sort((a, b) => a.emittedAt - b.emittedAt);
  }

  commitMessage(sessionId: string, runId: string, messageId: string): void {
    const run = this.#runs.get(runKey(sessionId, runId));
    if (!run) return;
    this.#flushPending(run);
    run.frames = run.frames.filter((frame) => frame.messageId !== messageId);
    run.bytes = run.frames.reduce(
      (total, frame) => total + JSON.stringify(frame).length,
      0,
    );
  }

  endRun(sessionId: string, runId: string): void {
    const key = runKey(sessionId, runId);
    const run = this.#runs.get(key);
    if (!run) return;
    this.#flushPending(run);
    if (run.timer) clearTimeout(run.timer);
    this.#runs.delete(key);
  }

  clearSession(sessionId: string): void {
    for (const [key, run] of this.#runs) {
      if (!key.startsWith(`${sessionId}\0`)) continue;
      if (run.timer) clearTimeout(run.timer);
      this.#runs.delete(key);
    }
  }

  dispose(): void {
    for (const run of this.#runs.values()) {
      if (run.timer) clearTimeout(run.timer);
    }
    this.#runs.clear();
  }

  #flushPending(run: BufferedRun): void {
    if (!run.pending) return;
    if (run.timer) {
      clearTimeout(run.timer);
      run.timer = undefined;
    }
    const frame: StreamFrameEnvelope = {
      ...run.pending,
      frameSeq: run.nextSeq++,
    };
    run.pending = undefined;
    run.frames.push(frame);
    run.bytes += JSON.stringify(frame).length;
    while (run.bytes > this.#maxBytesPerRun && run.frames.length > 1) {
      const removed = run.frames.shift()!;
      run.bytes -= JSON.stringify(removed).length;
    }
    this.#onFrame(frame);
  }
}
