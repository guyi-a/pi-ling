import type { TimelineItem, TimelineRun } from "../timeline/reducer";
import { describe, expect, it } from "vitest";

import { activityPhaseLabel, projectRunActivities } from "./project-run-activity";

function project(
  items: TimelineItem[],
  status: TimelineRun["status"] = "running",
  presentingMessageIds?: Set<string>,
) {
  return projectRunActivities({
    items,
    runs: { run: { id: "run", status } },
    ...(presentingMessageIds ? { presentingMessageIds } : {}),
  })[0]!;
}

const user: TimelineItem = {
  kind: "user",
  id: "u",
  runId: "run",
  createdSeq: 1,
  text: "go",
};

const assistant = (
  over: Partial<Extract<TimelineItem, { kind: "assistant" }>> = {},
): TimelineItem => ({
  kind: "assistant",
  id: "a1",
  runId: "run",
  turnId: "turn-1",
  createdSeq: 2,
  text: "",
  thinking: "",
  status: "streaming",
  ...over,
});

/**
 * 正文输出期间的 phase 判定。
 *
 * 曾经的缺陷：`planning` 是「没有工具在跑」的兜底状态，于是正文已经在输出时，
 * 左侧仍显示「Planning next steps」—— 用户会看到正文在动、标签却说在规划。
 *
 * 两条路径都要覆盖：
 * - 直播中：消息 `status === "streaming"`（此时还不在 liveMessageIds 里）
 * - 结束后：`assistant_end` 已到、内容仍在逐块浮现（在 presentingMessageIds 里）
 */
describe("run phase while the answer is streaming", () => {
  it("reports responding while assistant text streams during a live run", () => {
    const activity = project([
      user,
      assistant({ text: "这是正在流式输出的正文…" }),
    ]);
    expect(activity.viewMode).toBe("active");
    expect(activity.phase).toBe("responding");
    expect(activityPhaseLabel(activity.phase)).toBe("Writing response");
  });

  it("reports responding after the run ended but the answer is still revealing", () => {
    const activity = project(
      [
        user,
        assistant({
          text: "已经写完的最终答案",
          status: "completed",
          stopReason: "endTurn",
        }),
      ],
      "completed",
      new Set(["a1"]),
    );
    expect(activity.viewMode).toBe("active");
    expect(activity.finalAssistant).toBeDefined();
    expect(activity.phase).toBe("responding");
  });

  it("still reports planning when no text has arrived yet", () => {
    // 模型刚接活、还没吐字 —— 这时 planning 才是对的
    const activity = project([user, assistant({ text: "", status: "streaming" })]);
    expect(activity.phase).toBe("planning");
    expect(activityPhaseLabel(activity.phase)).toBe("Planning next steps");
  });

  it("keeps reporting planning when only whitespace has arrived", () => {
    // 流式首帧常常先来一个换行，不能因此就切到 responding
    const activity = project([
      user,
      assistant({ text: "\n  ", status: "streaming" }),
    ]);
    expect(activity.phase).toBe("planning");
  });

  it("prioritises a running tool over responding", () => {
    // 有工具在跑时，当前动作是那个工具，哪怕正文里已经有一段文字
    const activity = project([
      user,
      assistant({ text: "先看一下这个文件", status: "streaming" }),
      {
        kind: "tool",
        id: "t1",
        runId: "run",
        turnId: "turn-1",
        createdSeq: 3,
        callId: "t1",
        tool: "read_file",
        arguments: { path: "src/a.ts" },
        status: "running",
      },
    ]);
    expect(activity.phase).toBe("exploring");
  });

  it("settles to the terminal phase once nothing is being revealed", () => {
    // 揭示完毕（不在 presentingMessageIds 里）应回到完成态，而非卡在 responding
    const activity = project(
      [
        user,
        assistant({
          text: "答案",
          status: "completed",
          stopReason: "endTurn",
        }),
      ],
      "completed",
    );
    expect(activity.viewMode).toBe("settled");
    expect(activity.phase).toBe("completed");
  });
});
