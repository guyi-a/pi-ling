export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: { code?: number; message: string; data?: unknown };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export interface CodexThreadItem {
  id: string;
  type: string;
  text?: string;
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  changes?: Array<{ path: string; kind: string }>;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: { message?: string } | null;
  query?: string;
  plan?: unknown;
  contentItems?: unknown[];
  success?: boolean | null;
  summary?: string[];
  content?: string[];
}

export interface CodexTurn {
  id: string;
  status: string;
  items?: CodexThreadItem[];
  error?: { message?: string } | null;
}

export interface CodexDynamicToolSpec {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CodexApprovalRequest {
  threadId: string;
  turnId: string;
  itemId: string;
  command?: string | null;
  cwd?: string | null;
  reason?: string | null;
  availableDecisions?: unknown[] | null;
}

export interface CodexQuestionRequest {
  threadId: string;
  turnId: string;
  itemId: string;
  isBlocking: boolean;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    isOther?: boolean;
    isSecret?: boolean;
    options?: Array<{ label: string; description: string }> | null;
  }>;
}

export interface CodexDynamicToolCallRequest {
  threadId: string;
  turnId: string;
  callId: string;
  namespace?: string | null;
  tool: string;
  arguments: unknown;
}

export interface CodexSkillsListParams {
  cwds?: string[];
  forceReload?: boolean;
}

export interface CodexSkillMetadata {
  name: string;
  description: string;
  path: string;
  scope: string;
  enabled: boolean;
  pluginId: string | null;
}

export interface CodexSkillsListEntry {
  cwd: string;
  skills: CodexSkillMetadata[];
  errors: unknown[];
}

export interface CodexSkillsListResponse {
  data: CodexSkillsListEntry[];
}
