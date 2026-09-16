import { Check, Copy } from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { highlightCode, type HighlightLine } from "./code-highlighter";

/**
 * 复制按钮。
 *
 * 与 MarkdownCodeBlock 里的那个是同一种交互（图标从复制切成对勾、1.8s 后复原），
 * 但那边是纯文本渲染器自带的，无法直接复用，这里按同样行为实现一份。
 */
export const CopyButton = memo(function CopyButton(props: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // 某些 Electron 上下文里剪贴板不可用，静默忽略
    }
  }, [props.text]);

  return (
    <button
      type="button"
      className="inline-render-action"
      title={copied ? "已复制" : "复制"}
      aria-label={copied ? "已复制" : "复制代码"}
      onClick={() => void copy()}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
});

/**
 * 「查看源码」的代码视图 —— 带语法高亮。
 *
 * 高亮走共享的 Shiki 实例（code-highlighter.ts），主题与应用里的普通代码块
 * **完全一致**（light-plus / dark-plus），所以同一段 HTML 在代码块里和在
 * 这里看起来是一样的。
 *
 * 为什么不用嵌套一个 `<Markdown>` 来复用高亮：那会把 Streamdown 的代码块
 * 容器、边框和复制按钮一起带进来，与外层卡片形成「框套框」、按钮也会重叠
 * （之前修过同类问题）。自己渲染 token 只取颜色，不引入多余结构。
 */
export const SourceView = memo(function SourceView(props: {
  code: string;
  note?: string;
  /** 流式期间不高亮：内容每来一个分片都会变，反复高亮纯属白费算力。 */
  streaming?: boolean;
}) {
  /*
   * 高亮结果是异步来的（Shiki 首次使用某语言要加载语言包）。
   * 这里连同**源码一起存**：渲染时只有 source 与当前 code 相等才使用，
   * 否则会拿旧内容的着色去渲染新文本（内容与颜色错位）。
   */
  const [highlighted, setHighlighted] = useState<{
    source: string;
    lines: HighlightLine[];
  } | null>(null);

  useEffect(() => {
    if (props.streaming) return;
    let cancelled = false;
    void highlightCode(props.code, "html").then((lines) => {
      if (!cancelled && lines) {
        setHighlighted({ source: props.code, lines });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.code, props.streaming]);

  // 高亮没准备好 / 失败 / 内容已变 → 退回纯文本（绝不留空白）
  const lines =
    highlighted && highlighted.source === props.code ? highlighted.lines : null;

  return (
    <div className="inline-render-source">
      {props.note ? (
        <div className="inline-render-note">{props.note}</div>
      ) : null}
      <pre>
        <code>
          {lines
            ? lines.map((line, lineIndex) => (
                <span className="inline-render-line" key={lineIndex}>
                  {line.tokens.map((token, tokenIndex) => (
                    <span
                      className="inline-render-token"
                      key={tokenIndex}
                      style={
                        {
                          "--token-light": token.light,
                          "--token-dark": token.dark,
                        } as CSSProperties
                      }
                    >
                      {token.content}
                    </span>
                  ))}
                </span>
              ))
            : props.code}
        </code>
      </pre>
    </div>
  );
});
