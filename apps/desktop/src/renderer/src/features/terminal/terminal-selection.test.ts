import { describe, expect, it } from "vitest";

import { terminalSelectionAnchor } from "./terminal-selection";

/**
 * 终端选区锚点的坐标换算。
 *
 * 终端内容由 xterm 自己渲染，没有可选的 DOM 文本，所以按钮位置只能由
 * `getSelectionPosition()`（**缓冲区**坐标，含滚动偏移）+ 行列尺寸换算出来。
 * 这段换算有两个必须踩对的点，都在这里钉住。
 */
const HOST = { left: 100, top: 50, width: 800, height: 400 };
const BASE = { viewportY: 0, rows: 20, cols: 80, hostRect: HOST };

// 单元格尺寸：800/80 = 10 宽，400/20 = 20 高
describe("terminalSelectionAnchor", () => {
  it("maps a visible cell to viewport pixels", () => {
    // 第 2 行（0 基）第 5 列
    const anchor = terminalSelectionAnchor({ ...BASE, end: { x: 5, y: 2 } });
    expect(anchor).toEqual({
      left: 100 + 5 * 10,
      top: 50 + 3 * 20 - 20,
      right: 100 + 6 * 10,
      bottom: 50 + 3 * 20,
    });
  });

  it("subtracts viewportY so a scrolled-back terminal still lines up", () => {
    // 关键：end.y 是缓冲区行号，向上滚动后必须减去 viewportY
    const anchor = terminalSelectionAnchor({
      ...BASE,
      viewportY: 30,
      end: { x: 0, y: 33 }, // 可见第 3 行 → 50 + 3*20 = 110 起
    });
    expect(anchor?.top).toBe(50 + 3 * 20);
    expect(anchor?.bottom).toBe(50 + 4 * 20);
  });

  it("returns undefined when the selection end scrolled above the viewport", () => {
    expect(
      terminalSelectionAnchor({ ...BASE, viewportY: 50, end: { x: 0, y: 10 } }),
    ).toBeUndefined();
  });

  it("returns undefined when the selection end is below the viewport", () => {
    expect(
      terminalSelectionAnchor({ ...BASE, viewportY: 0, end: { x: 0, y: 25 } }),
    ).toBeUndefined();
  });

  it("accepts the last visible row", () => {
    const anchor = terminalSelectionAnchor({
      ...BASE,
      end: { x: 0, y: 19 },
    });
    expect(anchor).toBeDefined();
    expect(anchor?.bottom).toBe(50 + 20 * 20);
  });

  it("returns undefined before the host has been measured", () => {
    // 隐藏的终端（display:none）尺寸为 0，此时没有合法锚点
    expect(
      terminalSelectionAnchor({
        ...BASE,
        hostRect: { left: 0, top: 0, width: 0, height: 0 },
        end: { x: 0, y: 0 },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for an unmeasured grid", () => {
    // rows = 0 时任何行号都越界 —— 与其除零硬算，不如不给锚点
    expect(
      terminalSelectionAnchor({
        ...BASE,
        rows: 0,
        cols: 0,
        end: { x: 0, y: 0 },
      }),
    ).toBeUndefined();
  });

  it("does not produce NaN cell sizes on a degenerate grid", () => {
    // cols 为 0 但 rows 正常时，列宽要退化成 hostRect.width 而不是 NaN
    const anchor = terminalSelectionAnchor({
      ...BASE,
      cols: 0,
      end: { x: 1, y: 0 },
    });
    expect(anchor).toBeDefined();
    expect(Number.isFinite(anchor!.left)).toBe(true);
    expect(Number.isFinite(anchor!.right)).toBe(true);
  });
});
