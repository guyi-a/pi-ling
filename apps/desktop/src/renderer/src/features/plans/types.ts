export type SessionPlanStatus =
  | "draft"
  | "ready"
  | "building"
  | "built"
  | "rejected";

export interface SessionPlanPendingApproval {
  approvalItemId: string;
  callId: string;
  effectDigest: string;
}

export interface SessionPlan {
  planId: string;
  runId: string;
  source: "tool";
  format: "markdown";
  markdown: string;
  toolName: string;
  status: SessionPlanStatus;
  exitCallId?: string;
  buildRunId?: string;
  pendingApproval?: SessionPlanPendingApproval;
  updatedAt: number;
}

export type PlansRunFilter = "active" | "all";
