import type { WorkspaceTreeNode } from "@pi-ling/contracts";
import { useCallback, useMemo, useState, type KeyboardEvent } from "react";

import {
  filterWorkspaceFilesForMention,
  insertMentionAtToken,
  parseActiveMentionToken,
  type ActiveMentionToken,
} from "./composer-file-mention";

export function useComposerFileMention(options: {
  enabled: boolean;
  prompt: string;
  setPrompt: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  files: readonly WorkspaceTreeNode[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [token, setToken] = useState<ActiveMentionToken | null>(null);

  const filteredFiles = useMemo(
    () =>
      token
        ? filterWorkspaceFilesForMention(options.files, token.query)
        : [],
    [options.files, token],
  );

  const mentionOpen = options.enabled && token !== null;

  const closeMention = useCallback(() => {
    setToken(null);
    setActiveIndex(0);
  }, []);

  const syncMentionFromPrompt = useCallback(
    (nextPrompt: string, cursorIndex: number) => {
      if (!options.enabled) {
        closeMention();
        return;
      }
      const nextToken = parseActiveMentionToken(nextPrompt, cursorIndex);
      setToken(nextToken);
      setActiveIndex(0);
    },
    [closeMention, options.enabled],
  );

  const applyMention = useCallback(
    (relativePath: string) => {
      if (!token) return;
      const { nextText, nextCursor } = insertMentionAtToken(
        options.prompt,
        token,
        relativePath,
      );
      options.setPrompt(nextText);
      closeMention();
      requestAnimationFrame(() => {
        const textarea = options.textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [closeMention, options, token],
  );

  const handlePromptChange = useCallback(
    (nextPrompt: string, cursorIndex = nextPrompt.length) => {
      options.setPrompt(nextPrompt);
      syncMentionFromPrompt(nextPrompt, cursorIndex);
    },
    [options, syncMentionFromPrompt],
  );

  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!mentionOpen) return false;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (filteredFiles.length > 0) {
          setActiveIndex((current) => (current + 1) % filteredFiles.length);
        }
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (filteredFiles.length > 0) {
          setActiveIndex(
            (current) =>
              (current - 1 + filteredFiles.length) % filteredFiles.length,
          );
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMention();
        return true;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        filteredFiles.length > 0
      ) {
        event.preventDefault();
        const selected = filteredFiles[activeIndex] ?? filteredFiles[0];
        if (selected) {
          applyMention(selected.path);
        }
        return true;
      }
      return false;
    },
    [
      activeIndex,
      applyMention,
      closeMention,
      filteredFiles,
      mentionOpen,
    ],
  );

  const handleTextareaSelect = useCallback(() => {
    const textarea = options.textareaRef.current;
    if (!textarea) return;
    syncMentionFromPrompt(
      options.prompt,
      textarea.selectionStart ?? options.prompt.length,
    );
  }, [options.prompt, options.textareaRef, syncMentionFromPrompt]);

  return {
    mentionOpen,
    mentionQuery: token?.query ?? "",
    filteredFiles,
    activeIndex,
    closeMention,
    applyMention,
    handlePromptChange,
    handleTextareaKeyDown,
    handleTextareaSelect,
  };
}
