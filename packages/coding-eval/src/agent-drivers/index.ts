import type { EvalRuntime } from "../types.js";
import { CodexAgentDriver } from "./codex-agent.js";
import { DshAgentDriver } from "./dsh-agent.js";
import { NativeAgentDriver } from "./native-agent.js";
import type { AgentDriver } from "./types.js";

export function createAgentDriver(runtime: EvalRuntime): AgentDriver {
  if (runtime === "dsh") return new DshAgentDriver();
  if (runtime === "codex") return new CodexAgentDriver();
  return new NativeAgentDriver({ approvalMode: "auto" });
}

export {
  CodexAgentDriver,
  disposeSharedCodexEvalRuntime,
} from "./codex-agent.js";
export { NativeAgentDriver } from "./native-agent.js";
export { DshAgentDriver } from "./dsh-agent.js";
export type { AgentDriver } from "./types.js";
