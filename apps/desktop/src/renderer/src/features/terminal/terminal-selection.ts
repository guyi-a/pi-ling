/**
 * 终端选区 → 浮动按钮锚点。
 *
 * 放在独立模块而不是 `TerminalInstance.tsx` 里，有两个原因：
 * 1. 这是纯计算，可以单测；而组件文件会 import `@xterm/*`，在 node 测试环境里
 *    会因 `self is not defined` 直接加载失败（xterm 的 bundle 依赖浏览器全局）。
 * 2. 坐标换算本身是最容易写错的一环，值得单独钉住。
 */

export interface TerminalSelectionAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 把 xterm 的选区末端换算出按钮锚点（视口坐标）。
 *
 * 两处容易写错、必须单独测：
 * 1. `getSelectionPosition()` 返回的是**缓冲区**坐标（y 含滚动偏移），必须减去
 *    `viewportY` 才是屏幕上的可见行 —— 否则向上滚动过之后按钮会落到错误位置。
 * 2. 选区末端可能滚出了可视区，此时没有合适的锚点，返回 `undefined` 让调用方
 *    收起按钮，而不是硬算一个跑到面板外的坐标。
 */
export function terminalSelectionAnchor(input: {
  /** 选区末端（缓冲区坐标）。 */
  end: { x: number; y: number };
  viewportY: number;
  rows: number;
  cols: number;
  hostRect: { left: number; top: number; width: number; height: number };
}): TerminalSelectionAnchor | undefined {
  const { end, viewportY, rows, cols, hostRect } = input;
  if (hostRect.width === 0 || hostRect.height === 0) return undefined;
  // 缓冲区坐标 → 可见行
  const row = end.y - viewportY;
  if (row < 0 || row >= rows) return undefined;

  const cellWidth = hostRect.width / Math.max(cols, 1);
  const cellHeight = hostRect.height / Math.max(rows, 1);
  const left = hostRect.left + end.x * cellWidth;
  const bottom = hostRect.top + (row + 1) * cellHeight;
  return { left, top: bottom - cellHeight, right: left + cellWidth, bottom };
}
