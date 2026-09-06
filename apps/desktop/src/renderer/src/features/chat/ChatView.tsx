import { ArrowUp, Bot, Square } from "lucide-react";
import type { ApprovalMode, RuntimeKind } from "@pi-ling/contracts";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";

import type {
  ApprovalTimelineItem,
  TimelineItem,
  ToolTimelineItem,
} from "../../timeline/reducer";
import { ApprovalModePicker } from "./ApprovalModePicker";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { MessageItem } from "./MessageItem";
import { RuntimePicker } from "./RuntimePicker";
import { ToolCard } from "./ToolCard";

export function shouldSubmitComposer(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing;
}

export function ChatView(props: {
  items: TimelineItem[];
  modelLabel: string;
  workspaceReady: boolean;
  activeRunId: string | null;
  approvalMode: ApprovalMode;
  runtimeKind: RuntimeKind;
  availableRuntimes: RuntimeKind[];
  onSend: (prompt: string) => Promise<void>;
  onCancel: (runId: string) => void;
  onApproval: (
    item: ApprovalTimelineItem,
    approved: boolean,
  ) => Promise<void>;
  onApprovalModeChange: (mode: ApprovalMode) => Promise<void>;
  onRuntimeChange: (runtime: RuntimeKind) => void;
}) {
  const {
    items,
    modelLabel,
    workspaceReady,
    activeRunId,
    approvalMode,
    runtimeKind,
    availableRuntimes,
    onSend,
    onCancel,
    onApproval,
    onApprovalModeChange,
    onRuntimeChange,
  } = props;
  const [prompt, setPrompt] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldFollowRef = useRef(true);

  useEffect(() => {
    if (!shouldFollowRef.current) return;
    const frame = requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [items]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [prompt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || activeRunId || !workspaceReady) return;
    setPrompt("");
    setSendError(null);
    shouldFollowRef.current = true;
    try {
      await onSend(value);
    } catch (error) {
      setPrompt(value);
      setSendError(error instanceof Error ? error.message : String(error));
    }
  }

  const approvalsByTool = new Map(
    items
      .filter(
        (item): item is ApprovalTimelineItem => item.kind === "approval",
      )
      .map((item) => [item.toolItemId, item]),
  );
  const rendered: ReactNode[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.kind === "changes") continue;
    if (item.kind === "user") {
      rendered.push(<MessageItem item={item} key={item.id} />);
      continue;
    }
    if (item.kind === "approval") {
      continue;
    }
    if (item.kind === "assistant" && item.stopReason === "toolUse") {
      const tools: ToolTimelineItem[] = [];
      while (items[index + 1]?.kind === "tool") {
        tools.push(items[index + 1] as ToolTimelineItem);
        index += 1;
      }
      rendered.push(
        <ExecutionTimeline
          assistant={item}
          tools={tools}
          approvals={approvalsByTool}
          key={item.id}
          onApproval={(approval, approved) => {
            void onApproval(approval, approved);
          }}
        />,
      );
      continue;
    }
    if (item.kind === "assistant") {
      rendered.push(<MessageItem item={item} key={item.id} />);
      continue;
    }
    if (item.kind === "tool") {
      rendered.push(
        <ToolCard
          item={item}
          key={item.id}
          {...(approvalsByTool.get(item.id)
            ? { approval: approvalsByTool.get(item.id)! }
            : {})}
          onApproval={(approval, approved) => {
            void onApproval(approval, approved);
          }}
        />,
      );
    }
  }

  return (
    <section className="content" aria-label="会话">
      <div
        className="message-list"
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          shouldFollowRef.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        <div className="message-list-inner">
          {rendered.length > 0 ? (
            rendered
          ) : (
            <div className="empty-conversation" aria-label="空会话" />
          )}
        </div>
      </div>

      <div className="composer-wrap">
        <form className="composer" onSubmit={submit}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (shouldSubmitComposer({
                key: event.key,
                shiftKey: event.shiftKey,
                isComposing: event.nativeEvent.isComposing,
              })) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              workspaceReady
                ? "描述你想完成的任务"
                : "请先选择一个工作区"
            }
            rows={1}
            disabled={!workspaceReady}
          />
          {sendError ? <div className="message-error">{sendError}</div> : null}
          <div className="composer-footer">
            <div className="composer-controls">
              <RuntimePicker
                value={runtimeKind}
                available={availableRuntimes}
                disabled={Boolean(activeRunId)}
                onChange={onRuntimeChange}
              />
              <ApprovalModePicker
                value={approvalMode}
                disabled={!workspaceReady}
                onChange={onApprovalModeChange}
              />
              <div className="model-status" title={modelLabel}>
                <Bot />
                {modelLabel}
              </div>
            </div>
            {activeRunId ? (
              <button
                className="send-button stop"
                type="button"
                aria-label="停止"
                onClick={() => onCancel(activeRunId)}
              >
                <Square />
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                aria-label="发送"
                disabled={!prompt.trim() || !workspaceReady}
              >
                <ArrowUp />
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
