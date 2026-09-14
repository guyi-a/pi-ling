import { X } from "lucide-react";

import { useComposerContextStore } from "./composer-context-store";
import { snippetPreview } from "./selection-context";

/**
 * 输入框上方的引用片段芯片。
 *
 * 这里**只显示紧凑预览**，不铺全文 —— 一整段选中内容会把输入区撑得很高。
 * 完整正文在发送时才写进用户消息（见 `composePromptWithContext`）。
 * 鼠标悬停可看全文。
 */
export function ContextChips(props: { sessionId: string }) {
  const snippets = useComposerContextStore(
    (state) => state.pending[props.sessionId] ?? EMPTY,
  );
  const remove = useComposerContextStore((state) => state.remove);

  if (snippets.length === 0) return null;

  return (
    <div className="composer-context-chips" aria-label="已引用的内容">
      {snippets.map((snippet) => (
        <span
          key={snippet.id}
          className="composer-context-chip"
          title={snippet.text}
        >
          <span className="composer-context-chip-source">
            {snippet.source?.label ?? "引用"}
          </span>
          <span className="composer-context-chip-preview">
            {snippetPreview(snippet.text)}
          </span>
          <button
            type="button"
            className="composer-context-chip-remove"
            aria-label="移除这段引用"
            onClick={() => remove(props.sessionId, snippet.id)}
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** 稳定的空数组引用，避免 zustand 选择器每次返回新数组导致重渲染。 */
const EMPTY: never[] = [];
