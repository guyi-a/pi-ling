import { describe, expect, it, vi } from "vitest";

import {
  activeRows,
  estimateTokens,
  maybeCompact,
  split,
  summaryMessageText,
  thresholdTokens,
  wrapSummary,
  type CompactionConfig,
  type CompactionRecord,
  type CompactionRow,
} from "../src/index.js";

function testConfig(): CompactionConfig {
  return {
    enabled: true,
    windowNominalTokens: 1_000_000,
    windowUsableRatio: 0.9,
    reservedOutputTokens: 32_000,
    bufferTokens: 20_000,
    keepLastUserTurns: 0,
    charsPerToken: 4,
    toolResultTruncateThresholdChars: 100,
    toolResultTruncateKeepChars: 20,
  };
}

function row(partial: Partial<CompactionRow> & Pick<CompactionRow, "id" | "role">): CompactionRow {
  return {
    order: 0,
    content: "",
    ...partial,
  };
}

describe("compaction", () => {
  it("computes default threshold", () => {
    expect(thresholdTokens(testConfig())).toBe(848_000);
  });

  it("estimates with usage anchor plus tail", () => {
    const rows: CompactionRow[] = [
      row({ id: "1", role: "user", content: "x".repeat(4000), order: 0 }),
      row({ id: "2", role: "assistant", content: "done", totalTokens: 5000, order: 1 }),
      row({ id: "3", role: "user", content: "y".repeat(400), order: 2 }),
    ];
    expect(estimateTokens(rows, undefined, testConfig())).toBe(5100);
  });

  it("ignores anchor before active fold", () => {
    const rows: CompactionRow[] = [
      row({ id: "1", role: "user", content: "hi", order: 0 }),
      row({ id: "2", role: "assistant", content: "old", totalTokens: 90_000, order: 1 }),
      row({ id: "3", role: "user", content: "z".repeat(400), order: 2 }),
    ];
    const active: CompactionRecord = {
      id: "c1",
      throughMessageId: "2",
      summary: "s".repeat(400),
      replacedMessageIds: ["1", "2"],
      replacedCount: 2,
      estimatedTokens: 0,
    };
    expect(estimateTokens(rows, active, testConfig())).toBe(200);
  });

  it("activeRows drops folded prefix", () => {
    const rows: CompactionRow[] = [
      row({ id: "1", role: "user", order: 0 }),
      row({ id: "2", role: "assistant", order: 1 }),
      row({ id: "3", role: "user", order: 2 }),
      row({ id: "4", role: "assistant", order: 3 }),
    ];
    expect(activeRows(rows, { throughMessageId: "2" } as CompactionRecord).map((r) => r.id)).toEqual([
      "3",
      "4",
    ]);
  });

  it("split folds everything by default", () => {
    const rows: CompactionRow[] = [
      row({ id: "1", role: "user", content: "a", order: 0 }),
      row({ id: "2", role: "assistant", content: "b", order: 1 }),
      row({ id: "3", role: "user", content: "c", order: 2 }),
      row({ id: "4", role: "assistant", content: "d", order: 3 }),
    ];
    const plan = split(rows, undefined, 0);
    expect(plan?.folded).toHaveLength(4);
    expect(plan?.throughMessageId).toBe("4");
  });

  it("maybeCompact returns undefined below threshold", async () => {
    const result = await maybeCompact({
      rows: [row({ id: "1", role: "user", content: "hi" })],
      config: testConfig(),
      summarize: vi.fn(),
    });
    expect(result).toBeUndefined();
  });

  it("wraps summary for agent replay", () => {
    const text = wrapSummary("abc", "## 1. User Intent\nstuff");
    expect(text).toContain('<compacted-summary id="abc">');
    expect(text).toContain("Do NOT restart the task.");
    expect(summaryMessageText({
      id: "abc",
      throughMessageId: "1",
      summary: "## 1. User Intent\nstuff",
      replacedMessageIds: [],
      replacedCount: 0,
      estimatedTokens: 0,
    })).toContain("## 1. User Intent");
  });
});
