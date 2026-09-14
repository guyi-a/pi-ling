/**
 * 文件树刷新的节流器。
 *
 * 为什么需要区分「节流」与「立即」：
 *
 * - **环境型刷新**（终端每有输出、agent 每个 tool_end / changes 事件）频率很高，
 *   必须节流，否则文件树会被反复重取。
 * - **用户主动操作**（新建 / 删除 / 重命名 / 保存）**绝不能被节流丢弃** ——
 *   丢了就会出现「文件确实删掉了，但界面上还在」这种看起来像坏掉的假象。
 *
 * 早期版本只有一个带节流的 `refreshTree`，于是 agent 正在跑（或终端刚输出完）
 * 时用户去删文件，刷新会被静默吞掉 —— 表现为「删除不好使」。这里把两种语义
 * 分开，并把判定抽成纯函数以便测试。
 */
export interface RefreshThrottle {
  /**
   * 立即刷新：无条件放行，并重置节流窗口。
   * 用于用户主动操作。
   */
  immediate(now: number): boolean;
  /**
   * 节流刷新：距上次放行不足 `windowMs` 则拒绝。
   * 用于终端输出、agent 事件这类高频环境信号。
   */
  throttled(now: number): boolean;
}

export function createRefreshThrottle(windowMs: number): RefreshThrottle {
  let lastAt = Number.NEGATIVE_INFINITY;
  return {
    immediate(now: number) {
      lastAt = now;
      return true;
    },
    throttled(now: number) {
      if (now - lastAt < windowMs) return false;
      lastAt = now;
      return true;
    },
  };
}
