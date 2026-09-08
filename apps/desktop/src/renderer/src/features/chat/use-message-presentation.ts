import { useEffect, useMemo, useState } from "react";

import type {
  AssistantTimelineItem,
  TimelineItem,
  TimelineRun,
  ToolTimelineItem,
} from "../../timeline/reducer";

export type PresentationUnit =
  | {
      kind: "message";
      id: string;
      runId: string;
      createdSeq: number;
    }
  | {
      kind: "tool";
      id: string;
      runId: string;
      createdSeq: number;
    };

type CurrentUnit = PresentationUnit & { startedAt: number };

interface PresentationState {
  revealedChunks: Record<string, number>;
  visibleToolIds: Set<string>;
  current: CurrentUnit | undefined;
}

const punctuation = /[\s，。！？；：,.!?;:]/u;

function splitPlainText(value: string): string[] {
  const characters = Array.from(value);
  const chunks: string[] = [];
  let current = "";
  for (const character of characters) {
    current += character;
    const length = Array.from(current).length;
    if (
      (length >= 10 && punctuation.test(character)) ||
      length >= 24
    ) {
      chunks.push(current);
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitPresentationChunks(value: string): string[] {
  if (!value) return [];
  const chunks: string[] = [];
  const parts = value.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("```") && part.endsWith("```")) {
      chunks.push(part);
    } else {
      chunks.push(...splitPlainText(part));
    }
  }
  return chunks;
}

export function operationDwell(pendingCount: number): number {
  if (pendingCount >= 8) return 240;
  if (pendingCount >= 4) return 320;
  return 450;
}

export function chunkDelay(remainingChunks: number): number {
  if (remainingChunks >= 40) return 24;
  if (remainingChunks >= 16) return 36;
  return 55;
}

export function immediatePresentationRunIds(
  items: readonly TimelineItem[],
  runs: Readonly<Record<string, TimelineRun>>,
): Set<string> {
  const runIds = new Set<string>();
  for (const item of items) {
    if (item.kind === "approval" && item.status === "pending") {
      runIds.add(item.runId);
    }
    if (item.kind === "tool" && item.status === "awaiting-approval") {
      runIds.add(item.runId);
    }
  }
  for (const run of Object.values(runs)) {
    if (
      run.status === "error" ||
      run.status === "crashed" ||
      run.status === "cancelled"
    ) {
      runIds.add(run.id);
    }
  }
  return runIds;
}

export function pendingPresentationUnits(input: {
  items: readonly TimelineItem[];
  liveMessageIds: ReadonlySet<string>;
  revealedChunks: Readonly<Record<string, number>>;
  visibleToolIds: ReadonlySet<string>;
}): PresentationUnit[] {
  const units: PresentationUnit[] = [];
  for (const item of input.items) {
    if (item.kind === "assistant" && input.liveMessageIds.has(item.id)) {
      const total = splitPresentationChunks(item.text).length;
      if (
        (total === 0 && input.revealedChunks[item.id] === undefined) ||
        (input.revealedChunks[item.id] ?? 0) < total
      ) {
        units.push({
          kind: "message",
          id: item.id,
          runId: item.runId,
          createdSeq: item.createdSeq,
        });
      }
    } else if (
      item.kind === "tool" &&
      item.status !== "requested" &&
      !input.visibleToolIds.has(item.id)
    ) {
      units.push({
        kind: "tool",
        id: item.id,
        runId: item.runId,
        createdSeq: item.createdSeq,
      });
    }
  }
  return units.sort((left, right) => left.createdSeq - right.createdSeq);
}

export function activityPresentationRunIds(
  pending: readonly PresentationUnit[],
  current: PresentationUnit | undefined,
  revealedChunks: Readonly<Record<string, number>>,
): Set<string> {
  const runIds = new Set<string>();
  for (const unit of pending) {
    if (
      unit.kind === "tool" ||
      (revealedChunks[unit.id] ?? 0) === 0
    ) {
      runIds.add(unit.runId);
    }
  }
  if (
    current &&
    (current.kind === "tool" ||
      (revealedChunks[current.id] ?? 0) === 0)
  ) {
    runIds.add(current.runId);
  }
  return runIds;
}

function startUnit(
  state: PresentationState,
  unit: PresentationUnit,
  now: number,
  revealMessage = false,
): PresentationState {
  if (unit.kind === "tool") {
    const visibleToolIds = new Set(state.visibleToolIds);
    visibleToolIds.add(unit.id);
    return {
      ...state,
      visibleToolIds,
      current: { ...unit, startedAt: now },
    };
  }
  return {
    ...state,
    revealedChunks: {
      ...state.revealedChunks,
      [unit.id]: Math.max(
        revealMessage ? 1 : 0,
        state.revealedChunks[unit.id] ?? 0,
      ),
    },
    current: { ...unit, startedAt: now },
  };
}

export function useMessagePresentation(input: {
  sessionId: string | null;
  items: readonly TimelineItem[];
  liveMessageIds: ReadonlySet<string>;
  fastForwardRunIds: ReadonlySet<string>;
  onComplete: (messageId: string) => void;
}) {
  const assistants = useMemo(
    () =>
      input.items
        .filter(
          (item): item is AssistantTimelineItem =>
            item.kind === "assistant",
        )
        .sort((left, right) => left.createdSeq - right.createdSeq),
    [input.items],
  );
  const assistantById = useMemo(
    () => new Map(assistants.map((item) => [item.id, item])),
    [assistants],
  );
  const toolById = useMemo(
    () =>
      new Map(
        input.items
          .filter(
            (item): item is ToolTimelineItem => item.kind === "tool",
          )
          .map((item) => [item.id, item]),
      ),
    [input.items],
  );
  const [state, setState] = useState<PresentationState>(() => ({
    revealedChunks: Object.fromEntries(
      assistants
        .filter((item) => !input.liveMessageIds.has(item.id))
        .map((item) => [
          item.id,
          splitPresentationChunks(item.text).length,
        ]),
    ),
    visibleToolIds: new Set(
      input.items
        .filter(
          (item) =>
            item.kind === "tool" && item.status !== "requested",
        )
        .map((item) => item.id),
    ),
    current: undefined,
  }));
  const pending = pendingPresentationUnits({
    items: input.items,
    liveMessageIds: input.liveMessageIds,
    revealedChunks: state.revealedChunks,
    visibleToolIds: state.visibleToolIds,
  });
  const pendingKey = pending
    .map((unit) => `${unit.kind}:${unit.id}`)
    .join("|");
  const toolStateKey = [...toolById.values()]
    .map((tool) => `${tool.id}:${tool.status}`)
    .join("|");

  useEffect(() => {
    const blockedMessages = assistants.filter(
      (item) =>
        input.liveMessageIds.has(item.id) &&
        input.fastForwardRunIds.has(item.runId),
    );
    const blockedTools = [...toolById.values()].filter(
      (item) =>
        item.status !== "requested" &&
        input.fastForwardRunIds.has(item.runId),
    );
    if (blockedMessages.length === 0 && blockedTools.length === 0) {
      return;
    }
    setState((current) => {
      const revealedChunks = { ...current.revealedChunks };
      const visibleToolIds = new Set(current.visibleToolIds);
      let changed = false;
      for (const item of blockedMessages) {
        const total = splitPresentationChunks(item.text).length;
        if ((revealedChunks[item.id] ?? 0) < total) {
          revealedChunks[item.id] = total;
          changed = true;
        }
      }
      for (const item of blockedTools) {
        if (!visibleToolIds.has(item.id)) {
          visibleToolIds.add(item.id);
          changed = true;
        }
      }
      const shouldClear =
        current.current &&
        input.fastForwardRunIds.has(current.current.runId);
      if (!changed && !shouldClear) return current;
      return {
        revealedChunks,
        visibleToolIds,
        current:
          !shouldClear && current.current
            ? current.current
            : undefined,
      };
    });
  }, [
    assistants,
    input.fastForwardRunIds,
    input.liveMessageIds,
    toolById,
  ]);

  useEffect(() => {
    const current = state.current;
    if (!current) {
      const next = pending[0];
      if (next) {
        setState((value) => startUnit(value, next, Date.now()));
      }
      return;
    }

    const nextUnits = pending.filter(
      (unit) =>
        unit.kind !== current.kind || unit.id !== current.id,
    );
    if (current.kind === "message") {
      const item = assistantById.get(current.id);
      if (!item) return;
      const chunks = splitPresentationChunks(item.text);
      const revealed = state.revealedChunks[item.id] ?? 0;
      if (revealed < chunks.length) {
        const timer = window.setTimeout(() => {
          setState((value) => ({
            ...value,
            revealedChunks: {
              ...value.revealedChunks,
              [item.id]: Math.min(chunks.length, revealed + 1),
            },
          }));
        }, revealed === 0 ? 120 : chunkDelay(chunks.length - revealed));
        return () => window.clearTimeout(timer);
      }
      const remaining = Math.max(
        0,
        operationDwell(nextUnits.length) -
          (Date.now() - current.startedAt),
      );
      const timer = window.setTimeout(() => {
        setState((value) => {
          const next = nextUnits[0];
          return next
            ? startUnit(
                { ...value, current: undefined },
                next,
                Date.now(),
              )
            : { ...value, current: undefined };
        });
        const item = assistantById.get(current.id);
        if (
          item &&
          item.stopReason !== "toolUse" &&
          !input.fastForwardRunIds.has(item.runId)
        ) {
          input.onComplete(item.id);
        }
      }, remaining);
      return () => window.clearTimeout(timer);
    }

    const tool = toolById.get(current.id);
    if (!tool) return;
    const dwell = operationDwell(nextUnits.length);
    const remaining = Math.max(
      0,
      dwell - (Date.now() - current.startedAt),
    );
    const timer = window.setTimeout(() => {
      const stillActive =
        tool.status === "running" ||
        tool.status === "awaiting-approval";
      const next = nextUnits[0];
      if (!next && stillActive) return;
      setState((value) =>
        next
          ? startUnit(
              { ...value, current: undefined },
              next,
              Date.now(),
              next.kind === "message",
            )
          : { ...value, current: undefined },
      );
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [
    assistantById,
    input.onComplete,
    pendingKey,
    state.current,
    state.revealedChunks,
    toolById,
    toolStateKey,
  ]);

  const textFor = (item: AssistantTimelineItem): string => {
    if (!input.liveMessageIds.has(item.id)) return item.text;
    const chunks = splitPresentationChunks(item.text);
    return chunks
      .slice(0, state.revealedChunks[item.id] ?? 0)
      .join("");
  };
  const isComplete = (item: AssistantTimelineItem): boolean =>
    !input.liveMessageIds.has(item.id) ||
    (state.revealedChunks[item.id] ?? 0) >=
      splitPresentationChunks(item.text).length;
  const presentingRunIds = activityPresentationRunIds(
    pending,
    state.current,
    state.revealedChunks,
  );

  return {
    textFor,
    isComplete,
    visibleToolIds: state.visibleToolIds,
    currentToolId:
      state.current?.kind === "tool" ? state.current.id : undefined,
    presentingRunIds,
    presentingMessageIds: new Set(
      assistants
        .filter((item) => !isComplete(item))
        .map((item) => item.id),
    ),
    assistantById,
    revision:
      Object.values(state.revealedChunks).reduce(
        (total, count) => total + count,
        0,
      ) + state.visibleToolIds.size,
  };
}
