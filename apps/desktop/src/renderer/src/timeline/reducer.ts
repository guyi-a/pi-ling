import type {
  AgentUsage,
  ApprovalRequest,
  AskUserAnswer,
  ChangedFile,
  QuestionRequest,
  StreamFrameEnvelope,
  TimelineEnvelope,
  TimelineSnapshot,
  TimelineUserAttachment,
} from "@pi-ling/contracts";

const RUN_CANCELLED_BY_USER = "Run cancelled by user";

interface ItemBase {
  id: string;
  runId: string;
  createdSeq: number;
}

export interface UserTimelineItem extends ItemBase {
  kind: "user";
  text: string;
  attachments?: TimelineUserAttachment[];
}

export interface AssistantTimelineItem extends ItemBase {
  kind: "assistant";
  turnId: string;
  text: string;
  thinking: string;
  status: "streaming" | "completed" | "error";
  stopReason?: string;
  usage?: AgentUsage;
  contextUsage?: { used: number; size: number };
  error?: string;
}

export interface ToolTimelineItem extends ItemBase {
  kind: "tool";
  turnId: string;
  callId: string;
  tool: string;
  arguments: Record<string, unknown>;
  status:
    | "requested"
    | "awaiting-approval"
    | "running"
    | "completed"
    | "failed"
    | "denied"
    | "cancelled";
  output?: string;
}

export interface ApprovalTimelineItem extends ItemBase {
  kind: "approval";
  turnId: string;
  toolItemId: string;
  approval: ApprovalRequest;
  status: "pending" | "approved" | "denied";
}

export interface QuestionTimelineItem extends ItemBase {
  kind: "question";
  turnId: string;
  toolItemId: string;
  question: QuestionRequest;
  status: "pending" | "answered" | "cancelled";
  answers?: AskUserAnswer[];
}

export interface ChangesTimelineItem extends ItemBase {
  kind: "changes";
  turnId: string;
  callId: string;
  files: ChangedFile[];
}

export interface CompactionTimelineItem extends ItemBase {
  kind: "compaction";
  compactionId: string;
  replacedCount: number;
  throughMessageId: string;
}

export type TimelineItem =
  | UserTimelineItem
  | AssistantTimelineItem
  | ToolTimelineItem
  | ApprovalTimelineItem
  | QuestionTimelineItem
  | ChangesTimelineItem
  | CompactionTimelineItem;

export interface TimelineRun {
  id: string;
  status: "running" | "completed" | "cancelled" | "error" | "crashed";
}

export interface TimelineState {
  sessionId: string | null;
  lastSeq: number;
  received: Record<number, TimelineEnvelope>;
  items: TimelineItem[];
  runs: Record<string, TimelineRun>;
  frameSeqByRun: Record<string, number>;
}

export type TimelineAction =
  | { type: "event"; envelope: TimelineEnvelope }
  | { type: "snapshot"; snapshot: TimelineSnapshot }
  | { type: "frame"; frame: StreamFrameEnvelope }
  | { type: "replace"; state: TimelineState }
  | { type: "clear" };

export function createTimelineState(): TimelineState {
  return {
    sessionId: null,
    lastSeq: 0,
    received: {},
    items: [],
    runs: {},
    frameSeqByRun: {},
  };
}

export function applyStreamFrame(
  state: TimelineState,
  envelope: StreamFrameEnvelope,
): TimelineState {
  if (state.sessionId !== envelope.sessionId) return state;
  if ((state.frameSeqByRun[envelope.runId] ?? 0) >= envelope.frameSeq) {
    return state;
  }
  let items = state.items;
  if (envelope.frame.kind === "tool.status" && envelope.toolCallId) {
    const frame = envelope.frame;
    items = updateItem<ToolTimelineItem>(
      items,
      envelope.toolCallId,
      (item) => ({ ...item, status: frame.status }),
    );
  }
  return {
    ...state,
    items,
    frameSeqByRun: {
      ...state.frameSeqByRun,
      [envelope.runId]: envelope.frameSeq,
    },
  };
}

function updateItem<T extends TimelineItem>(
  items: TimelineItem[],
  id: string,
  update: (item: T) => T,
): TimelineItem[] {
  return items.map((item) => (item.id === id ? update(item as T) : item));
}

function applyEvent(
  state: TimelineState,
  envelope: TimelineEnvelope,
): TimelineState {
  const { event, runId, seq } = envelope;
  let items = state.items;
  let runs = state.runs;

  switch (event.type) {
    case "run_start":
      if (!event.continuation) {
        items = [
          ...items,
          {
            kind: "user",
            id: event.userItemId,
            runId,
            createdSeq: seq,
            text: event.prompt,
            ...(event.attachments && event.attachments.length > 0
              ? { attachments: event.attachments }
              : {}),
          },
        ];
      }
      runs = { ...runs, [runId]: { id: runId, status: "running" } };
      break;
    case "run_end":
      runs = { ...runs, [runId]: { id: runId, status: event.status } };
      if (event.status !== "completed") {
        let failedAssigned = false;
        items = items.map((item) => {
          if (item.kind === "question" && item.runId === runId) {
            return item.status === "pending"
              ? { ...item, status: "cancelled" as const }
              : item;
          }
          if (
            item.kind !== "tool" ||
            item.runId !== runId ||
            ["completed", "failed", "denied", "cancelled"].includes(
              item.status,
            )
          ) {
            return item;
          }
          if (
            item.status === "running" &&
            event.status === "cancelled"
          ) {
            return {
              ...item,
              status: "failed",
              output: item.output ?? RUN_CANCELLED_BY_USER,
            };
          }
          if (
            (event.status === "error" || event.status === "crashed") &&
            !failedAssigned
          ) {
            failedAssigned = true;
            return { ...item, status: "failed" };
          }
          return { ...item, status: "cancelled" };
        });
      }
      break;
    case "assistant_start":
      if (!items.some((item) => item.id === event.itemId)) {
        items = [
          ...items,
          {
            kind: "assistant",
            id: event.itemId,
            runId,
            turnId: event.turnId,
            createdSeq: seq,
            text: "",
            thinking: "",
            status: "streaming",
          },
        ];
      } else {
        items = updateItem<AssistantTimelineItem>(
          items,
          event.itemId,
          (item) => ({
            ...item,
            status: "streaming",
          }),
        );
      }
      break;
    case "assistant_text_delta":
      items = updateItem<AssistantTimelineItem>(
        items,
        event.itemId,
        (item) => ({ ...item, text: item.text + event.delta }),
      );
      break;
    case "assistant_thinking_delta":
      items = updateItem<AssistantTimelineItem>(
        items,
        event.itemId,
        (item) => ({
          ...item,
          thinking: item.thinking + event.delta,
        }),
      );
      break;
    case "assistant_end":
      items = updateItem<AssistantTimelineItem>(
        items,
        event.itemId,
        (item) => ({
          ...item,
          status: event.error ? "error" : "completed",
          stopReason: event.stopReason,
          ...(event.usage ? { usage: event.usage } : {}),
          ...(event.contextUsage ? { contextUsage: event.contextUsage } : {}),
          ...(event.error ? { error: event.error } : {}),
        }),
      );
      break;
    case "tool_requested":
      if (!items.some((item) => item.id === event.itemId)) {
        items = [
          ...items,
          {
            kind: "tool",
            id: event.itemId,
            runId,
            turnId: event.turnId,
            createdSeq: seq,
            callId: event.callId,
            tool: event.tool,
            arguments: event.arguments,
            status: "requested",
          },
        ];
      }
      break;
    case "approval_requested":
      items = updateItem<ToolTimelineItem>(
        items,
        event.toolItemId,
        (item) => ({ ...item, status: "awaiting-approval" }),
      );
      if (!items.some((item) => item.id === event.itemId)) {
        items = [
          ...items,
          {
            kind: "approval",
            id: event.itemId,
            runId,
            turnId: event.turnId,
            createdSeq: seq,
            toolItemId: event.toolItemId,
            approval: event.approval,
            status: "pending",
          },
        ];
      }
      break;
    case "approval_resolved":
      items = updateItem<ApprovalTimelineItem>(
        items,
        event.itemId,
        (item) => ({
          ...item,
          status: event.approved ? "approved" : "denied",
        }),
      );
      items = updateItem<ToolTimelineItem>(
        items,
        event.toolItemId,
        (item) => ({
          ...item,
          status: event.approved ? "requested" : "denied",
        }),
      );
      break;
    case "question_requested":
      if (!items.some((item) => item.id === event.itemId)) {
        items = [
          ...items,
          {
            kind: "question",
            id: event.itemId,
            runId,
            turnId: event.turnId,
            createdSeq: seq,
            toolItemId: event.toolItemId,
            question: event.question,
            status: "pending",
          },
        ];
      }
      break;
    case "question_answered":
      items = updateItem<QuestionTimelineItem>(
        items,
        event.itemId,
        (item) => ({
          ...item,
          status: "answered",
          answers: event.answers,
        }),
      );
      break;
    case "tool_start":
      items = updateItem<ToolTimelineItem>(
        items,
        event.itemId,
        (item) => ({ ...item, status: "running" }),
      );
      break;
    case "tool_end":
      items = updateItem<ToolTimelineItem>(
        items,
        event.itemId,
        (item) => ({
          ...item,
          status: event.isError ? "failed" : "completed",
          output: event.output,
        }),
      );
      break;
    case "changes":
      if (!items.some((item) => item.id === event.itemId)) {
        items = [
          ...items,
          {
            kind: "changes",
            id: event.itemId,
            runId,
            turnId: event.turnId,
            createdSeq: seq,
            callId: event.callId,
            files: event.files,
          },
        ];
      } else {
        items = updateItem<ChangesTimelineItem>(
          items,
          event.itemId,
          (item) => ({ ...item, files: event.files }),
        );
      }
      break;
    case "compaction_marker":
      if (!items.some((item) => item.id === event.itemId)) {
        items = [
          ...items,
          {
            kind: "compaction",
            id: event.itemId,
            runId,
            createdSeq: seq,
            compactionId: event.compactionId,
            replacedCount: event.replacedCount,
            throughMessageId: event.throughMessageId,
          },
        ];
      }
      break;
    case "turn_start":
    case "turn_end":
      break;
  }

  return { ...state, items, runs, lastSeq: seq };
}

function drain(state: TimelineState): TimelineState {
  let current = state;
  while (true) {
    const next = current.received[current.lastSeq + 1];
    if (!next) {
      return current;
    }
    current = applyEvent(current, next);
  }
}

export function applyTimelineEnvelope(
  state: TimelineState,
  envelope: TimelineEnvelope,
): TimelineState {
  const base =
    state.sessionId === null || state.sessionId === envelope.sessionId
      ? state
      : createTimelineState();
  if (
    base.sessionId !== null &&
    base.sessionId !== envelope.sessionId
  ) {
    return base;
  }
  if (base.received[envelope.seq]) {
    return base;
  }
  const next: TimelineState = {
    ...base,
    sessionId: envelope.sessionId,
    received: { ...base.received, [envelope.seq]: envelope },
  };
  return drain(next);
}

export function applyTimelineSnapshot(
  state: TimelineState,
  snapshot: TimelineSnapshot,
): TimelineState {
  const live =
    state.sessionId === snapshot.sessionId ? Object.values(state.received) : [];
  const all = [...snapshot.events, ...live].sort(
    (left, right) => left.seq - right.seq,
  );
  let next = createTimelineState();
  for (const envelope of all) {
    next = applyTimelineEnvelope(next, envelope);
  }
  if (next.sessionId === null) {
    next = { ...next, sessionId: snapshot.sessionId };
  }
  return next;
}

export function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
): TimelineState {
  if (action.type === "clear") {
    return createTimelineState();
  }
  if (action.type === "replace") {
    return action.state;
  }
  if (action.type === "snapshot") {
    return applyTimelineSnapshot(state, action.snapshot);
  }
  if (action.type === "frame") {
    return applyStreamFrame(state, action.frame);
  }
  return applyTimelineEnvelope(state, action.envelope);
}
