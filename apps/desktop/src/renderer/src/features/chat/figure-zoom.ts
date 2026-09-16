/**
 * 图表缩放阶梯（纯逻辑，可单测）。
 *
 * 为什么不用连续缩放：图的排版是固定的，档位式缩放能让每次点击的结果可预期，
 * 也避免出现 `137%` 这种读不出意义的百分比。
 *
 * 1 表示「适应宽度」—— 图默认按容器宽度铺满，这也是打开全屏时的起点：
 * 全屏容器比对话列宽得多，所以档位 1 本身就已经是放大了。
 */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4] as const;

export const DEFAULT_ZOOM = 1;

export const MIN_ZOOM: number = ZOOM_STEPS[0]!;
export const MAX_ZOOM: number = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/**
 * 在当前档位上前进 / 后退一档。
 *
 * 若 `current` 不是精确档位（例如来自别处的配置），先吸附到最近档位再走一步 ——
 * 这样不会因为浮点误差卡住不动。
 */
export function stepZoom(current: number, direction: -1 | 1): number {
  let nearest = 0;
  let smallestGap = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ZOOM_STEPS.length; index += 1) {
    const gap = Math.abs(ZOOM_STEPS[index]! - current);
    if (gap < smallestGap) {
      smallestGap = gap;
      nearest = index;
    }
  }
  const next = nearest + direction;
  if (next < 0) return MIN_ZOOM;
  if (next >= ZOOM_STEPS.length) return MAX_ZOOM;
  return ZOOM_STEPS[next]!;
}

/** 能否继续放大 / 缩小 —— 用于禁用按钮，避免点了没反应。 */
export function canZoom(current: number, direction: -1 | 1): boolean {
  return stepZoom(current, direction) !== current;
}

/** 百分比文案，用整数避免出现 `112.5%`。 */
export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
