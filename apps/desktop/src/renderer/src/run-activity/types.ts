import type { AgentUsage } from "@pi-ling/contracts";

import type {
  ApprovalTimelineItem,
  AssistantTimelineItem,
  ChangesTimelineItem,
  TimelineRun,
  ToolTimelineItem,
  UserTimelineItem,
} from "../timeline/reducer";
import type { RunTodoSnapshot } from "./project-run-todos";

export type RunPhase =
  | "planning"
  /**
   * 正在产出正文。
   *
   * 与 `planning` 的区别：`planning` 是「没有工具在跑、也没在写正文」的兜底状态
   * （模型在思考下一步）。一旦正文开始输出（无论还在流式，还是结束后的逐块浮现），
   * 继续显示「Planning next steps」就是错的 —— 用户会看到正文在动、标签却说在规划。
   */
  | "responding"
  | "exploring"
  | "editing"
  | "running"
  | "verifying"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface SubagentSummary {
  description: string;
  background: boolean;
}

export interface RunActivityCounters {
  editedFiles: string[];
  exploredFiles: string[];
  subagents: SubagentSummary[];
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
  runUsage?: {
    usage?: AgentUsage;
    contextUsage?: { used: number; size: number };
  };
  hasActivity: boolean;
  hasBlockingApproval: boolean;
  todos?: RunTodoSnapshot;
}
