import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";

export function MarkdownCodeBlock(props: {
  code: string;
  language: string;
  isIncomplete?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable in some Electron contexts.
    }
  }, [props.code]);

  return (
    <div
      className="markdown-code-block"
      data-language={props.language || "text"}
      data-incomplete={props.isIncomplete ? "true" : undefined}
    >
      <div className="markdown-code-block-actions">
        <button
          type="button"
          className="markdown-code-block-action"
          title={copied ? "已复制" : "复制"}
          aria-label={copied ? "已复制" : "复制代码"}
          onClick={() => void copy()}
        >
          {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
        </button>
      </div>
      <pre>
        <code>{props.code}</code>
      </pre>
    </div>
  );
}
