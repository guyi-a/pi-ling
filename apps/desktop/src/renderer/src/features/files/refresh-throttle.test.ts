import { describe, expect, it } from "vitest";

import { createRefreshThrottle } from "./refresh-throttle";

const WINDOW = 600;

describe("createRefreshThrottle", () => {
  it("lets the first throttled call through", () => {
    const throttle = createRefreshThrottle(WINDOW);
    expect(throttle.throttled(1000)).toBe(true);
  });

  it("drops throttled calls inside the window", () => {
    const throttle = createRefreshThrottle(WINDOW);
    expect(throttle.throttled(1000)).toBe(true);
    expect(throttle.throttled(1300)).toBe(false);
    expect(throttle.throttled(1599)).toBe(false);
  });

  it("allows a throttled call once the window has passed", () => {
    const throttle = createRefreshThrottle(WINDOW);
    expect(throttle.throttled(1000)).toBe(true);
    expect(throttle.throttled(1600)).toBe(true);
  });

  it("never drops an immediate call", () => {
    // 这是核心契约：用户主动操作不能被节流吞掉
    const throttle = createRefreshThrottle(WINDOW);
    expect(throttle.throttled(1000)).toBe(true);
    expect(throttle.immediate(1001)).toBe(true);
    expect(throttle.immediate(1002)).toBe(true);
    expect(throttle.immediate(1003)).toBe(true);
  });

  it("lets an immediate call through even right after a throttled one", () => {
    // 复现真实场景：agent 事件刚触发过环境刷新，用户紧接着删文件
    const throttle = createRefreshThrottle(WINDOW);
    throttle.throttled(5000); // agent 的 tool_end
    // 同一次点击里的删除，必须仍然生效
    expect(throttle.immediate(5050)).toBe(true);
  });

  it("resets the window after an immediate call", () => {
    const throttle = createRefreshThrottle(WINDOW);
    throttle.immediate(1000);
    // 紧跟其后的环境刷新要等窗口过去
    expect(throttle.throttled(1200)).toBe(false);
    expect(throttle.throttled(1600)).toBe(true);
  });
});
