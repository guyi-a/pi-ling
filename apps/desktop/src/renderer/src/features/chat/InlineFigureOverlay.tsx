import { Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ShadowFigure } from "./FigureSurface";
import { DEFAULT_ZOOM, canZoom, formatZoom, stepZoom } from "./figure-zoom";

/**
 * 图表全屏查看器。
 *
 * 为什么需要它：图是按**容器宽度**自适应的（SVG 撑满对话列），所以信息密度大的
 * 图在对话列里必然偏小。全屏把可用宽度从 ~600px 提到整屏，再叠上档位缩放，
 * 细节点才读得清。
 *
 * 渲染走 `ShadowFigure`，与内联视图共用同一份 shadow 样式 —— 主题跟随、
 * 缩放机制、消毒后的内容都一致，不会出现「全屏里长得不一样」。
 */
export function InlineFigureOverlay(props: {
  html: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  const zoomIn = useCallback(() => setZoom((z) => stepZoom(z, 1)), []);
  const zoomOut = useCallback(() => setZoom((z) => stepZoom(z, -1)), []);

  // Esc 关闭；+/- 也能缩放（键盘操作比反复点小按钮顺手）
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose, zoomIn, zoomOut]);

  /*
   * 打开期间锁住底层滚动。
   *
   * 注意必须保存原值再还原，而不是直接置空 —— 置空会覆盖掉别处可能设过的
   * overflow，关闭后留下副作用。
   */
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      className="figure-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="图表全屏查看"
      onClick={props.onClose}
    >
      <div
        className="figure-overlay-panel"
        // 点面板内部不该关闭
        onClick={(event) => event.stopPropagation()}
      >
        <div className="figure-overlay-bar">
          <div className="figure-overlay-zoom">
            <button
              type="button"
              className="figure-overlay-button"
              title="缩小（-）"
              aria-label="缩小"
              disabled={!canZoom(zoom, -1)}
              onClick={zoomOut}
            >
              <Minus size={14} />
            </button>
            <span className="figure-overlay-percent" aria-live="polite">
              {formatZoom(zoom)}
            </span>
            <button
              type="button"
              className="figure-overlay-button"
              title="放大（+）"
              aria-label="放大"
              disabled={!canZoom(zoom, 1)}
              onClick={zoomIn}
            >
              <Plus size={14} />
            </button>
            {zoom !== DEFAULT_ZOOM ? (
              <button
                type="button"
                className="figure-overlay-reset"
                onClick={() => setZoom(DEFAULT_ZOOM)}
              >
                适应宽度
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="figure-overlay-button"
            title="关闭（Esc）"
            aria-label="关闭"
            onClick={props.onClose}
          >
            <X size={15} />
          </button>
        </div>
        <div className="figure-overlay-stage">
          <ShadowFigure
            html={props.html}
            zoom={zoom}
            className="figure-overlay-figure"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
