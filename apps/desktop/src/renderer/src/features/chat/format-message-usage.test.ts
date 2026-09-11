import { describe, expect, it } from "vitest";

import type { AssistantTimelineItem } from "../../timeline/reducer";

import {
  aggregateRunUsage,
  formatMessageUsage,
  fullPromptTokens,
} from "./format-message-usage";

function assistant(
  partial: Partial<AssistantTimelineItem> & Pick<AssistantTimelineItem, "id">,
): AssistantTimelineItem {
  return {
    kind: "assistant",
    runId: "run-1",
    turnId: partial.id,
    createdSeq: 1,
    text: "",
    thinking: "",
    status: "completed",
    ...partial,
  };
}

describe("formatMessageUsage", () => {
  it("uses full prompt tokens instead of billable input only", () => {
    expect(fullPromptTokens({ input: 144, output: 64, totalTokens: 3152, cost: 0 })).toBe(
      3088,
    );
    expect(
      formatMessageUsage({
        usage: { input: 144, output: 64, totalTokens: 3152, cost: 0 },
      }),
    ).toBe("3.1k 输入 · 64 输出");
  });

  it("formats the screenshot case with complete input and turn output", () => {
    expect(
      formatMessageUsage({
        usage: { input: 69, output: 314, totalTokens: 3500, cost: 0 },
      }),
    ).toBe("3.2k 输入 · 314 输出");
  });

  it("maps DSH context usage to complete input", () => {
    expect(
      formatMessageUsage({
        contextUsage: { used: 8700, size: 1_000_000 },
        usage: { input: 0, output: 0, totalTokens: 0, cost: 0 },
      }),
    ).toBe("8.7k 输入");
  });

  it("sums output across tool rounds and keeps the last prompt as input", () => {
    const aggregated = aggregateRunUsage([
      assistant({
        id: "turn-1",
        usage: { input: 50, output: 800, totalTokens: 20_850, cost: 0 },
      }),
      assistant({
        id: "turn-2",
        usage: { input: 69, output: 428, totalTokens: 24_428, cost: 0 },
        contextUsage: { used: 24_000, size: 128_000 },
      }),
    ]);

    expect(aggregated.usage?.output).toBe(1228);
    expect(
      formatMessageUsage({
        usage: aggregated.usage,
        contextUsage: aggregated.contextUsage,
      }),
    ).toBe("24k 输入 · 1.2k 输出");
  });

  it("prefers persisted context usage over recomputed prompt tokens", () => {
    expect(
      formatMessageUsage({
        contextUsage: { used: 3088, size: 128_000 },
        usage: { input: 144, output: 64, totalTokens: 3152, cost: 0 },
      }),
    ).toBe("3.1k 输入 · 64 输出");
  });
});
