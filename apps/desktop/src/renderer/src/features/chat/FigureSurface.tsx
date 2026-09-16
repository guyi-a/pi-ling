import { memo, useEffect, useRef } from "react";
import type { CSSProperties } from "react";

/**
 * 注入到 shadow root 里的基础样式。
 *
 * 为什么要把样式放进 shadow root（而不是写在 chat.css）：shadow boundary
 * 会把外部 CSS 完全隔断 —— 这既是我们要的（模型写的选择器不会污染应用），
 * 也意味着**不注入就没有任何样式**。
 *
 * 关键点：**CSS 自定义属性（变量）会继承穿透 shadow boundary**。所以这里直接
 * 引用应用的 `var(--text)` 等 token，渲染结果就自动跟随浅色 / 深色主题，
 * 不需要监听主题变化做任何额外处理。
 *
 * 缩放也走同一条路：组件把 `--figure-zoom` 打在宿主元素上，这里消费它。
 * 于是「内联」与「全屏」两处用同一份样式，只是传进来的倍率不同。
 */
export const BASE_CSS = `
:host { display: block; }
* { box-sizing: border-box; }
.wrap {
  /*
   * 缩放要做两件事，缺一不可。
   *
   * 1) zoom —— 用 zoom 而不是 transform: scale()。本应用只跑在 Electron
   *    （Chromium）上，zoom 参与布局，所以放大后外层滚动容器能正确出现滚动条、
   *    能滚到右下角。transform 不参与布局，垂直方向的溢出不会被算进滚动范围。
   *
   * 2) width: calc(100% * zoom) —— 这一条才是真正让图变大的。
   *    踩过的坑：只写 zoom 的话，百分比宽度（width: 100%）是在 zoom 建立的
   *    坐标系里解析的（该坐标系把包含块宽度除以倍率），于是布局宽 =
   *    容器宽/倍率，再乘回倍率，视觉宽度恒等于容器宽 —— SVG 永远铺满容器，
   *    放大按钮点了没反应（实测：zoom:2 时 rect 宽 681、容器 1398，完全不溢出）。
   *    乘上倍率后，视觉宽 = 容器宽 × 倍率，才真正溢出并可滚动。
   *
   * 实测对照（容器 1398px，zoom: 2）：
   *   width:100%            → 滚动宽 1398（不溢出，无效）
   *   width:calc(100% * 2)  → 滚动宽 2743（溢出，可滚动）
   *
   * 注意：本字符串是模板字符串，注释里不能出现反引号 —— 否则会截断字符串，
   * 导致整个文件语法错误（踩过）。
   */
  zoom: var(--figure-zoom, 1);
  width: calc(100% * var(--figure-zoom, 1));
  font-family: "Segoe UI Variable", "Segoe UI", ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.65;
  color: var(--text, #ececec);
  word-break: break-word;
}
.wrap svg { display: block; max-width: 100%; height: auto; }
.wrap img { max-width: 100%; height: auto; }
.wrap table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.wrap th, .wrap td {
  padding: 6px 10px;
  border: 1px solid var(--border, #2b2b2b);
  text-align: left;
  vertical-align: top;
}
.wrap th { background: var(--surface-2, #252526); font-weight: 600; }
.wrap code {
  padding: 0.1em 0.35em;
  border-radius: 3px;
  background: var(--surface-2, #252526);
  font-family: var(--font-mono, monospace);
  font-size: 0.92em;
}
.wrap pre {
  margin: 0;
  overflow-x: auto;
  white-space: pre-wrap;
}
`;

/**
 * 把（已消毒的）HTML 挂进 shadow root 渲染。
 *
 * 调用方负责消毒 —— 这里只做挂载，这样内联与全屏两条路径共用同一份
 * 「挂载 + 注入样式」的实现，不会各自漂移。
 */
export const ShadowFigure = memo(function ShadowFigure(props: {
  html: string;
  zoom?: number;
  className?: string;
  hidden?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 创建 shadow root 并注入基础样式 —— 只做一次
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    /*
     * `host.shadowRoot ??` 是必须的：React StrictMode 在开发模式下会重复执行
     * effect，而 attachShadow 对已有 shadow tree 的宿主会抛
     * "Shadow root cannot be created on a host which already hosts a shadow tree"。
     */
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.replaceChildren();

    const style = document.createElement("style");
    style.textContent = BASE_CSS;
    const body = document.createElement("div");
    body.className = "wrap";
    bodyRef.current = body;
    shadow.append(style, body);
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.innerHTML = props.html;
  }, [props.html]);

  return (
    <div
      ref={hostRef}
      className={props.className}
      hidden={props.hidden}
      style={{ "--figure-zoom": String(props.zoom ?? 1) } as CSSProperties}
    />
  );
});
