import type { EvalRuntime } from "../types.js";
import { DshAgentDriver } from "./dsh-agent.js";
import { NativeAgentDriver } from "./native-agent.js";
import type { AgentDriver } from "./types.js";

export function createAgentDriver(runtime: EvalRuntime): AgentDriver {
  if (runtime === "dsh") return new DshAgentDriver();
  return new NativeAgentDriver({ approvalMode: "auto" });
}

export { NativeAgentDriver } from "./native-agent.js";
export { DshAgentDriver } from "./dsh-agent.js";
export type { AgentDriver } from "./types.js";
