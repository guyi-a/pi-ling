import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChangedFile } from "@pi-ling/contracts";

import type { ToolTimelineItem } from "../../timeline/reducer";
import { SubagentToolCard } from "./cards/SubagentToolCard";
import { WebSearchToolCard } from "./cards/WebSearchToolCard";

function tool(
  name: string,
  patch: Partial<ToolTimelineItem> = {},
): ToolTimelineItem {
  return {
    kind: "tool",
    id: `tool-${name}`,
    runId: "run",
    turnId: "turn",
    createdSeq: 1,
    callId: name,
    tool: name,
    arguments: {},
    status: "completed",
    ...patch,
  };
}

describe("tool cards start collapsed", () => {
  it("keeps a completed web search collapsed even with results", () => {
    const html = renderToStaticMarkup(
      <WebSearchToolCard
        item={tool("web_search", {
          arguments: { query: "小美 机器 能量水平" },
          output: "1. 小美 机器\n   https://example.com\n   body",
        })}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("tool-web-search-body");
  });

  it("keeps a finished subagent collapsed even with a result", () => {
    const html = renderToStaticMarkup(
      <SubagentToolCard
        item={tool("spawn_subagent", {
          arguments: {
            description: "调研会话恢复",
            task: "调研会话恢复",
            prompt: "调研会话恢复",
          },
          output: "Auth lives in src/auth.ts",
        })}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("tool-subagent-body");
  });

  it("keeps a failed tool collapsed too, surfacing only the red status", () => {
    const html = renderToStaticMarkup(
      <WebSearchToolCard
        item={tool("web_search", {
          status: "failed",
          arguments: { query: "x" },
          output: "rate limited",
        })}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Failed");
    expect(html).not.toContain("tool-web-search-body");
  });
});

describe("RunActivityBlock does not list changed files", () => {
  it("leaves changed files to the Changes panel", async () => {
    const { RunActivityBlock } = await import("./RunActivityBlock");
    const changed: ChangedFile = {
      path: "work/bench.py",
      status: "added",
      binary: false,
      sensitive: false,
      tooLarge: false,
    };
    const html = renderToStaticMarkup(
      <RunActivityBlock
        forceOpen
        activity={{
          runId: "run",
          lifecycle: "completed",
          viewMode: "settled",
          phase: "completed",
          counters: {
            editedFiles: [],
            exploredFiles: [],
            subagents: [],
            commandCount: 0,
            toolCount: 1,
            failedToolCount: 0,
            approvalCount: 0,
            pendingApprovalCount: 0,
          },
          summary: "Edited 1 file",
          tools: [],
          approvals: [],
          changes: [
            {
              kind: "changes",
              id: "c1",
              runId: "run",
              turnId: "turn",
              createdSeq: 1,
              callId: "c1",
              files: [changed],
            },
          ],
          thinking: "",
          segments: [],
          workSegments: [],
          hasUnsettledWork: false,
          hasActivity: true,
          hasBlockingApproval: false,
        }}
      />,
    );
    expect(html).not.toContain("run-activity-changes");
    expect(html).not.toContain("bench.py");
  });
});
