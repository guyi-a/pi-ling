import type {
  RuntimeApprovalPolicy,
  RuntimeSandboxMode,
} from "@pi-ling/runtime-contracts";

import { CodexAppServerTransport } from "./codex-app-server-transport.js";
import type {
  CodexDynamicToolSpec,
  CodexSkillsListParams,
  CodexSkillsListResponse,
  CodexTurn,
  JsonRpcNotification,
  JsonRpcRequest,
} from "./codex-app-server-types.js";

function approvalPolicy(
  policy: RuntimeApprovalPolicy,
): "never" | "on-request" | "untrusted" {
  return policy === "on-failure" ? "on-request" : policy;
}

function sandboxPolicy(
  mode: RuntimeSandboxMode,
  workspaceRoot: string,
): Record<string, unknown> {
  if (mode === "danger-full-access") return { type: "dangerFullAccess" };
  if (mode === "read-only") {
    return { type: "readOnly", networkAccess: false };
  }
  return {
    type: "workspaceWrite",
    writableRoots: [workspaceRoot],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

export interface CodexThreadConfiguration {
  workspaceRoot: string;
  model: string;
  sandboxMode: RuntimeSandboxMode;
  approvalPolicy: RuntimeApprovalPolicy;
  composerMode?: "plan" | "ask" | "agent";
  dynamicTools?: CodexDynamicToolSpec[];
}

export class CodexAppServerClient {
  readonly #transport: CodexAppServerTransport;

  constructor(transport: CodexAppServerTransport) {
    this.#transport = transport;
  }

  get diagnostics(): string {
    return this.#transport.diagnostics;
  }

  onNotification(
    listener: (notification: JsonRpcNotification) => void,
  ): () => void {
    return this.#transport.onNotification(listener);
  }

  onServerRequest(
    listener: (request: JsonRpcRequest) => Promise<unknown> | unknown,
  ): () => void {
    return this.#transport.onServerRequest(listener);
  }

  async initialize(): Promise<void> {
    await this.#transport.start();
    await this.#transport.request("initialize", {
      clientInfo: {
        name: "pi_ling",
        title: "pi-ling",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });
    this.#transport.notify("initialized");
  }

  async startThread(
    configuration: CodexThreadConfiguration,
  ): Promise<string> {
    const response = await this.#transport.request<{
      thread: { id: string };
    }>("thread/start", {
      model: configuration.model,
      modelProvider: "deepseek",
      cwd: configuration.workspaceRoot,
      runtimeWorkspaceRoots: [configuration.workspaceRoot],
      approvalPolicy: approvalPolicy(configuration.approvalPolicy),
      approvalsReviewer: "user",
      sandbox: configuration.sandboxMode,
      dynamicTools: configuration.dynamicTools ?? [],
      ephemeral: false,
      experimentalRawEvents: false,
    });
    return response.thread.id;
  }

  async resumeThread(
    threadId: string,
    configuration: CodexThreadConfiguration,
  ): Promise<string> {
    const response = await this.#transport.request<{
      thread: { id: string };
    }>("thread/resume", {
      threadId,
      model: configuration.model,
      modelProvider: "deepseek",
      cwd: configuration.workspaceRoot,
      runtimeWorkspaceRoots: [configuration.workspaceRoot],
      approvalPolicy: approvalPolicy(configuration.approvalPolicy),
      approvalsReviewer: "user",
      sandbox: configuration.sandboxMode,
      excludeTurns: true,
    });
    return response.thread.id;
  }

  async startTurn(
    threadId: string,
    prompt: string,
    configuration: CodexThreadConfiguration,
  ): Promise<string> {
    const response = await this.#transport.request<{ turn: CodexTurn }>(
      "turn/start",
      {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        cwd: configuration.workspaceRoot,
        runtimeWorkspaceRoots: [configuration.workspaceRoot],
        approvalPolicy: approvalPolicy(configuration.approvalPolicy),
        approvalsReviewer: "user",
        sandboxPolicy: sandboxPolicy(
          configuration.sandboxMode,
          configuration.workspaceRoot,
        ),
        model: configuration.model,
        ...(configuration.composerMode === "plan"
          ? {
              collaborationMode: {
                mode: "plan",
                settings: {
                  model: configuration.model,
                  reasoning_effort: "high",
                  developer_instructions: null,
                },
              },
            }
          : {}),
      },
    );
    return response.turn.id;
  }

  interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.#transport.request("turn/interrupt", { threadId, turnId });
  }

  listSkills(
    params: CodexSkillsListParams = {},
  ): Promise<CodexSkillsListResponse> {
    return this.#transport.request("skills/list", params);
  }

  setSkillsExtraRoots(extraRoots: string[]): Promise<unknown> {
    return this.#transport.request("skills/extraRoots/set", { extraRoots });
  }

  dispose(): Promise<void> {
    return this.#transport.dispose();
  }
}
