import { Check, Copy } from "lucide-react";
import { useCallback, useState } from "react";

export function MessageCopyButton(props: { text: string }) {
  const [copied, setCopied] = useState(false);
  const trimmed = props.text.trim();

  const copy = useCallback(async () => {
    if (!trimmed) {
      return;
    }
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable in some Electron contexts.
    }
  }, [trimmed]);

  if (!trimmed) {
    return null;
  }

  return (
    <div className="message-copy-actions">
      <button
        type="button"
        className="message-copy-action"
        title={copied ? "已复制" : "复制消息"}
        aria-label={copied ? "已复制" : "复制消息"}
        onClick={() => void copy()}
      >
        {copied ? (
          <Check size={14} strokeWidth={2} />
        ) : (
          <Copy size={14} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}
