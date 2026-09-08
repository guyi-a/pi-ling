import { afterEach, describe, expect, it } from "vitest";

import type { ToolTimelineItem } from "../timeline/reducer";
import {
  registerToolDescriptor,
  resetToolRegistryForTests,
  resolveToolDescriptor,
  resolveToolLabel,
  resolveToolTarget,
} from "./tool-registry";

function tool(name: string, args: Record<string, unknown> = {}): ToolTimelineItem {
  return {
    kind: "tool",
    id: "call-1",
    runId: "run-1",
    turnId: "turn-1",
    createdSeq: 1,
    callId: "call-1",
    tool: name,
    arguments: args,
    status: "completed",
  };
}

describe("tool-registry", () => {
  afterEach(() => {
    resetToolRegistryForTests();
  });

  it("resolves specialized descriptors by priority", () => {
    expect(resolveToolDescriptor(tool("todo_write")).id).toBe("todo");
    expect(resolveToolDescriptor(tool("web_search")).id).toBe("web-search");
    expect(resolveToolDescriptor(tool("read_file")).id).toBe("read");
    expect(resolveToolDescriptor(tool("unknown_tool")).id).toBe("default");
  });

  it("delegates label and target to taxonomy helpers", () => {
    expect(resolveToolLabel(tool("glob"))).toBe("Glob");
    expect(resolveToolLabel(tool("list_files"))).toBe("List");
    expect(
      resolveToolTarget(tool("glob", { glob_pattern: "**/*.ts" })),
    ).toBe("**/*.ts");
  });

  it("allows registering custom descriptors", () => {
    registerToolDescriptor({
      id: "custom",
      priority: 100,
      match: (item) => item.tool === "custom_tool",
      label: "Custom",
      category: "other",
      target: () => "custom-target",
      action: () => ({ verb: "Customizing", target: "custom-target" }),
    });
    expect(resolveToolLabel(tool("custom_tool"))).toBe("Custom");
  });
});
