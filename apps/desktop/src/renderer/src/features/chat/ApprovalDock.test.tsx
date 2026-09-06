import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApprovalTimelineItem } from "../../timeline/reducer";
import { ApprovalDock } from "./ApprovalDock";

function approval(id: string, path: string): ApprovalTimelineItem {
  return {
    kind: "approval",
    id,
    runId: "run",
    turnId: "turn",
    createdSeq: id === "first" ? 1 : 2,
    toolItemId: id,
    status: "pending",
    approval: {
      callId: id,
      tool: "write_file",
      arguments: { path },
      effect: { kind: "filesystem-write", path },
      effectDigest: id,
      reason: `write ${path}`,
    },
  };
}

describe("ApprovalDock", () => {
  it("renders only the first pending approval in FIFO order", () => {
    const html = renderToStaticMarkup(
      <ApprovalDock
        approvals={[
          approval("first", "a.ts"),
          approval("second", "b.ts"),
        ]}
        onDecision={() => {}}
      />,
    );
    expect(html).toContain("1/2");
    expect(html).toContain("a.ts");
    expect(html).not.toContain("b.ts");
  });
});
