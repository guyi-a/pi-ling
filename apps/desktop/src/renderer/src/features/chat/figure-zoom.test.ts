import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  canZoom,
  formatZoom,
  stepZoom,
} from "./figure-zoom";

function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

const FIGURE_SURFACE_TSX = readSource("./FigureSurface.tsx");
const INLINE_OVERLAY_TSX = readSource("./InlineFigureOverlay.tsx");
const INLINE_RENDERER_TSX = readSource("./InlineRendererView.tsx");
const CHAT_CSS = readSource("../../styles/chat.css");

/** 剥掉注释再断言，否则解释性注释里的词会误伤负向断言。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("stepZoom", () => {
  it("walks the ladder one step at a time", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.25, 1)).toBe(1.5);
    expect(stepZoom(1.25, -1)).toBe(1);
    expect(stepZoom(1, -1)).toBe(0.75);
  });

  it("clamps at both ends instead of running off the ladder", () => {
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    // 极端值也不能越界
    expect(stepZoom(0.01, -1)).toBe(MIN_ZOOM);
    expect(stepZoom(99, 1)).toBe(MAX_ZOOM);
  });

  it("snaps a non-ladder value to the nearest step before moving", () => {
    // 来自配置 / 历史记录的脏值不能让缩放卡住
    expect(stepZoom(1.02, 1)).toBe(1.25);
    expect(stepZoom(0.99, -1)).toBe(0.75);
  });

  it("keeps 100% (fit width) as the default and on the ladder", () => {
    expect(DEFAULT_ZOOM).toBe(1);
    expect(ZOOM_STEPS).toContain(1);
  });

  it("reports whether another step is possible", () => {
    expect(canZoom(1, 1)).toBe(true);
    expect(canZoom(1, -1)).toBe(true);
    expect(canZoom(MAX_ZOOM, 1)).toBe(false);
    expect(canZoom(MIN_ZOOM, -1)).toBe(false);
  });
});

describe("formatZoom", () => {
  it("renders whole percentages", () => {
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(1.25)).toBe("125%");
    expect(formatZoom(0.5)).toBe("50%");
    // 不能出现 112.5% 这种读不出意义的百分比
    expect(formatZoom(1.125)).not.toContain(".");
  });
});

describe("zoom wiring contract", () => {
  it("drives zoom through a CSS variable instead of a transform", () => {
    /*
     * 用 zoom 而不是 transform: scale()：zoom 参与布局，放大后外层滚动容器
     * 能正确出现滚动条、能滚到右下角；transform 不参与布局，放大会溢出到
     * 看不见的地方。
     */
    expect(stripComments(FIGURE_SURFACE_TSX)).toMatch(
      /zoom:\s*var\(--figure-zoom/,
    );
    expect(stripComments(FIGURE_SURFACE_TSX)).not.toMatch(/transform:\s*scale/);
  });

  it("passes the zoom factor to the shadow host from both views", () => {
    // 内联与全屏共用同一份样式，只是传进来的倍率不同
    expect(FIGURE_SURFACE_TSX).toContain('"--figure-zoom"');
    expect(INLINE_OVERLAY_TSX).toContain("zoom={zoom}");
  });

  it("reuses the shared shadow surface so the two views cannot drift", () => {
    for (const [name, source] of [
      ["InlineRendererView.tsx", INLINE_RENDERER_TSX],
      ["InlineFigureOverlay.tsx", INLINE_OVERLAY_TSX],
    ] as const) {
      expect(source, name).toContain("ShadowFigure");
      // 不允许各自实现一遍 attachShadow
      expect(stripComments(source), name).not.toContain("attachShadow");
    }
    // 挂载逻辑只应存在于一处
    expect(FIGURE_SURFACE_TSX).toContain("attachShadow");
  });

  it("closes the overlay on Escape", () => {
    expect(INLINE_OVERLAY_TSX).toContain('event.key === "Escape"');
    expect(INLINE_OVERLAY_TSX).toContain(
      'window.addEventListener("keydown"',
    );
  });

  it("portals the overlay out of the message flow", () => {
    // 对话列有 overflow 与层叠上下文，不做 portal 会被裁切
    expect(INLINE_OVERLAY_TSX).toContain("createPortal");
    expect(INLINE_OVERLAY_TSX).toContain("document.body");
  });

  it("locks and restores background scroll instead of clearing it", () => {
    // 直接置空会覆盖别处设过的 overflow，关闭后留下副作用
    expect(INLINE_OVERLAY_TSX).toContain("document.body.style.overflow");
    expect(INLINE_OVERLAY_TSX).toMatch(/const previous = document\.body\.style\.overflow/);
    expect(INLINE_OVERLAY_TSX).toMatch(/document\.body\.style\.overflow = previous/);
  });

  it("zooms with a scrollable stage so enlarged content stays reachable", () => {
    expect(CHAT_CSS).toMatch(/\.figure-overlay-stage\s*\{[^}]*overflow:\s*auto/);
  });

  it("stacks the overlay above the composer menus", () => {
    // 输入区菜单用的是 1000/1001，全屏时不该被它盖住
    const overlayZ = Number(
      CHAT_CSS.match(/\.figure-overlay\s*\{[^}]*z-index:\s*(\d+)/)?.[1] ?? 0,
    );
    const menuZ = Number(
      CHAT_CSS.match(/\.composer-mention-menu\s*\{[^}]*z-index:\s*(\d+)/)?.[1] ?? 0,
    );
    expect(overlayZ).toBeGreaterThan(menuZ);
    expect(overlayZ).toBeGreaterThan(1001);
  });

  it("keeps the fullscreen affordance out of source mode", () => {
    // 源码模式下没有图可放大，按钮不该出现
    expect(INLINE_RENDERER_TSX).toContain("!sourceMode && sanitized !== null");
  });
});
