import { ArrowUp, Bot, Square } from "lucide-react";
import type { ApprovalMode, RuntimeKind } from "@pi-ling/contracts";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";

import type {
  ApprovalTimelineItem,
  TimelineItem,
  TimelineRun,
} from "../../timeline/reducer";
import { projectRunActivities } from "../../run-activity/project-run-activity";
import { ApprovalModePicker } from "./ApprovalModePicker";
import { ApprovalDock } from "./ApprovalDock";
import { MessageItem } from "./MessageItem";
import { RunActivityBlock } from "./RunActivityBlock";
import { RuntimePicker } from "./RuntimePicker";
import {
  immediatePresentationRunIds,
  useMessagePresentation,
} from "./use-message-presentation";

export function shouldSubmitComposer(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing;
}

export function ChatView(props: {
  sessionId: string | null;
  items: TimelineItem[];
  runs: Record<string, TimelineRun>;
  liveMessageIds: ReadonlySet<string>;
  onMessagePresented: (messageId: string) => void;
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
    sessionId,
    items,
    runs,
    liveMessageIds,
    onMessagePresented,
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
  const fastForwardRunIds = useMemo(
    () => immediatePresentationRunIds(items, runs),
    [items, runs],
  );
  const presentation = useMessagePresentation({
    sessionId,
    items,
    liveMessageIds,
    fastForwardRunIds,
    onComplete: onMessagePresented,
  });
  const pendingApprovals = items
    .filter(
      (item): item is ApprovalTimelineItem =>
        item.kind === "approval" && item.status === "pending",
    )
    .sort((left, right) => left.createdSeq - right.createdSeq);

  useEffect(() => {
    if (!shouldFollowRef.current) return;
    const frame = requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [items, presentation.revision]);

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

  const rendered: ReactNode[] = [];
  for (const activity of projectRunActivities({
    items,
    runs,
    presentingMessageIds: presentation.presentingMessageIds,
    presentingRunIds: presentation.presentingRunIds,
    visibleToolIds: presentation.visibleToolIds,
    ...(presentation.currentToolId
      ? { currentToolId: presentation.currentToolId }
      : {}),
  })) {
    if (activity.user) {
      rendered.push(
        <MessageItem item={activity.user} key={activity.user.id} />,
      );
    }
    if (activity.hasActivity) {
      rendered.push(
        <RunActivityBlock
          activity={activity}
          displayText={presentation.textFor}
          isMessageComplete={presentation.isComplete}
          key={`${activity.runId}:activity`}
        />,
      );
    }
    if (activity.finalAssistant) {
      const text = presentation.textFor(activity.finalAssistant);
      const complete = presentation.isComplete(activity.finalAssistant);
      if (text || complete) {
        rendered.push(
          <MessageItem
            item={{
              ...activity.finalAssistant,
              text,
              status: complete
                ? activity.finalAssistant.status
                : "streaming",
            }}
            hideThinking
            key={activity.finalAssistant.id}
          />,
        );
      }
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
        <ApprovalDock
          approvals={pendingApprovals}
          onDecision={(approval, approved) => {
            void onApproval(approval, approved);
          }}
        />
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
