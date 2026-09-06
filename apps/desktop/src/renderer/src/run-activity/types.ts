import type {
  ApprovalTimelineItem,
  AssistantTimelineItem,
  ChangesTimelineItem,
  TimelineRun,
  ToolTimelineItem,
  UserTimelineItem,
} from "../timeline/reducer";

export type RunPhase =
  | "planning"
  | "exploring"
  | "editing"
  | "running"
  | "verifying"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface RunActivityCounters {
  editedFiles: string[];
  exploredFiles: string[];
  commandCount: number;
  toolCount: number;
  failedToolCount: number;
  approvalCount: number;
  pendingApprovalCount: number;
  additions?: number;
  deletions?: number;
}

export interface RunActivityAction {
  verb: string;
  target: string;
  toolItemId?: string;
}

export interface RunActivitySegment {
  turnId: string;
  content: string;
  assistant: AssistantTimelineItem;
  tools: ToolTimelineItem[];
}

export interface RunActivityModel {
  runId: string;
  user?: UserTimelineItem;
  lifecycle: TimelineRun["status"];
  viewMode: "active" | "settled";
  phase: RunPhase;
  currentAction?: RunActivityAction;
  counters: RunActivityCounters;
  summary: string;
  tools: ToolTimelineItem[];
  approvals: ApprovalTimelineItem[];
  changes: ChangesTimelineItem[];
  thinking: string;
  segments: RunActivitySegment[];
  workSegments: RunActivitySegment[];
  hasUnsettledWork: boolean;
  finalAssistant?: AssistantTimelineItem;
  hasActivity: boolean;
  hasBlockingApproval: boolean;
}
