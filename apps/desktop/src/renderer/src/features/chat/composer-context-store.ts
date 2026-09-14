import { create } from "zustand";

import type { ContextSnippet } from "./selection-context";

/**
 * 待加入对话的上下文片段（发送前的暂存区）。
 *
 * 与 `attachments-store` 分开：附件的语义是「文件」，会走 IPC 落盘并在消息里
 * 渲染成缩略图；而引用片段只是一段文本，发送时被序列化进用户消息正文。
 * 两者生命周期一致（发送成功即清空），但链路完全不同。
 */
interface ComposerContextStore {
  pending: Record<string, ContextSnippet[]>;
  add: (sessionId: string, snippet: Omit<ContextSnippet, "id">) => void;
  remove: (sessionId: string, id: string) => void;
  clear: (sessionId: string) => void;
}

let seq = 0;
const nextId = () => `ctx-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const useComposerContextStore = create<ComposerContextStore>(
  (set, get) => ({
    pending: {},

    add: (sessionId, snippet) => {
      const current = get().pending[sessionId] ?? [];
      // 同一段内容重复添加就忽略，避免用户手快点两次带进两份一样的长文本
      const duplicate = current.some(
        (item) =>
          item.text === snippet.text &&
          item.source?.label === snippet.source?.label,
      );
      if (duplicate) return;
      set({
        pending: {
          ...get().pending,
          [sessionId]: [...current, { ...snippet, id: nextId() }],
        },
      });
    },

    remove: (sessionId, id) => {
      const current = get().pending[sessionId] ?? [];
      const next = current.filter((item) => item.id !== id);
      const map = { ...get().pending };
      if (next.length === 0) delete map[sessionId];
      else map[sessionId] = next;
      set({ pending: map });
    },

    clear: (sessionId) => {
      const map = { ...get().pending };
      delete map[sessionId];
      set({ pending: map });
    },
  }),
);

/** 读取当前待发送的引用片段（发送时序列化用）。 */
export function toContextSnippets(sessionId: string): ContextSnippet[] {
  return useComposerContextStore.getState().pending[sessionId] ?? [];
}
