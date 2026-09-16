import DOMPurify from "dompurify";
import { Code2, Eye, Maximize2 } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { ShadowFigure } from "./FigureSurface";
import { InlineFigureOverlay } from "./InlineFigureOverlay";
import { CopyButton, SourceView } from "./SourceView";
import {
  cssReferencesExternalResource,
  sanitizeRendererHtml,
  shouldDropExternalUri,
} from "./renderer-block";

/**
 * 安装消毒钩子并返回 purifier —— 只装一次。
 *
 * 为什么需要钩子：`RENDERER_SANITIZE_CONFIG` 只能做「整标签 / 整属性」级别的
 * 控制，表达不了「`href` 可以留，但如果指向外部就删掉」这种**按值**判断。
 * DOMPurify 的 `ALLOWED_URI_REGEXP` 看着像为这个准备的，但它对属性名的匹配
 * 过于宽松，会把 `viewBox` / `fill` 也一起判死（见 renderer-block.ts 的注释）。
 *
 * 钩子是装在 DOMPurify 单例上的，属于全局副作用 —— 所以只装一次，
 * 且本应用里 DOMPurify 仅此一处使用。
 */
let purifier: typeof DOMPurify | null = null;

function acquirePurifier(): typeof DOMPurify {
  if (purifier) return purifier;
  DOMPurify.addHook("uponSanitizeAttribute", (_node, event) => {
    // 按属性名 + 取值精确判定：外部 URI 一律不保留
    if (shouldDropExternalUri(event.attrName, event.attrValue)) {
      event.keepAttr = false;
      event.forceKeepAttr = undefined;
    }
  });
  DOMPurify.addHook("uponSanitizeElement", (node, event) => {
    // <style> 里的 @import / url(https://...) 会真的发请求，而 DOMPurify
    // 不解析 CSS。带外部引用的整块丢弃（宁可少样式，不可静默联网）。
    if (event.tagName !== "style") return;
    const element = node as Element;
    if (cssReferencesExternalResource(element.textContent ?? "")) {
      element.remove();
    }
  });
  purifier = DOMPurify;
  return purifier;
}

/**
 * 把模型输出的 HTML/SVG 渲染成图（卡片 / 流程图 / 表格等）。
 *
 * 与代码块的关系：注册在 `html` / `svg` 语言上会命中**所有**该语言的围栏，
 * 包括普通的 `<div>...</div>` 代码示例。所以调用方必须先按 meta 分派，
 * 只有带 `type="renderer"` 的才进到这里（见 Markdown.tsx）。
 */
export const InlineRendererView = memo(function InlineRendererView(props: {
  code: string;
  /** 流式未完成：HTML 不完整时渲染会崩，改为占位。 */
  isIncomplete?: boolean;
}) {
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [sanitized, setSanitized] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // 消毒：只在这里做一次，内联与全屏两份视图共用同一份结果
  useEffect(() => {
    if (props.isIncomplete) {
      setSanitized(null);
      setFailure(null);
      return;
    }
    const result = sanitizeRendererHtml(props.code, acquirePurifier());
    if (!result.ok) {
      // 失败降级：绝不留空白，交给下面的 SourceView 显示原始内容
      setSanitized(null);
      setFailure(result.message);
      return;
    }
    setSanitized(result.html);
    setFailure(null);
  }, [props.code, props.isIncomplete]);

  const streaming = Boolean(props.isIncomplete);
  const sourceMode = streaming || showSource || failure !== null;
  const note = streaming
    ? "图表生成中…"
    : failure !== null
      ? `渲染失败（${failure}），以下为原始内容`
      : undefined;

  return (
    <div className="inline-render">
      {!streaming ? (
        <div className="inline-render-actions">
          {!sourceMode && sanitized !== null ? (
            <button
              type="button"
              className="inline-render-action"
              title="全屏查看"
              aria-label="全屏查看"
              onClick={() => setFullscreen(true)}
            >
              <Maximize2 size={13} />
            </button>
          ) : null}
          {sourceMode ? <CopyButton text={props.code} /> : null}
          <button
            type="button"
            className="inline-render-action"
            title={showSource ? "查看渲染结果" : "查看源码"}
            aria-label={showSource ? "查看渲染结果" : "查看源码"}
            aria-pressed={showSource}
            onClick={() => setShowSource((current) => !current)}
          >
            {showSource ? <Eye size={13} /> : <Code2 size={13} />}
          </button>
        </div>
      ) : null}
      {/*
        渲染容器始终挂载（不能条件渲染）：shadow root 挂在它上面，
        卸载再挂载会让 effect 重建、丢掉已注入的样式。
        源码模式下靠 `hidden` 收起（chat.css 里有一条 `.inline-render-host[hidden]`
        兜住 display，否则会被本身的 `display: block` 压过 UA 样式表）。
      */}
      <ShadowFigure
        html={sanitized ?? ""}
        className="inline-render-host"
        hidden={sourceMode}
      />
      {sourceMode ? (
        <SourceView
          code={props.code}
          streaming={streaming}
          {...(note !== undefined ? { note } : {})}
        />
      ) : null}
      {fullscreen && sanitized !== null ? (
        <InlineFigureOverlay
          html={sanitized}
          onClose={() => setFullscreen(false)}
        />
      ) : null}
    </div>
  );
});
