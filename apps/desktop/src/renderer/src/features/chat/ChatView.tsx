import { ArrowUp, Bot, ImagePlus, Square } from "lucide-react";
import type { ApprovalMode, PromptAttachment, RuntimeKind } from "@pi-ling/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  ReactNode,
} from "react";

import type {
  ApprovalTimelineItem,
  TimelineItem,
  TimelineRun,
} from "../../timeline/reducer";
import { projectRunActivities } from "../../run-activity/project-run-activity";
import { changesFilesByRunId } from "../../run-activity/run-changes";
import { ApprovalModePicker } from "./ApprovalModePicker";
import { ApprovalDock } from "./ApprovalDock";
import { AttachmentChips } from "./AttachmentChips";
import {
  saveImageFiles,
  toPromptAttachments,
  useAttachmentsStore,
} from "./attachments-store";
import { MessageItem } from "./MessageItem";
import { RunActivityBlock } from "./RunActivityBlock";
import { TurnBlock } from "./TurnBlock";
import { TurnChangesCard } from "./TurnChangesCard";
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

const EMPTY_ATTACHMENTS: PromptAttachment[] = [];

export function ChatView(props: {
  sessionId: string | null;
  items: TimelineItem[];
  runs: Record<string, TimelineRun>;
  liveMessageIds: ReadonlySet<string>;
  onMessagePresented: (messageId: string) => void;
  modelLabel: string;
  workspaceReady: boolean;
  workspaceRoot?: string;
  activeRunId: string | null;
  approvalMode: ApprovalMode;
  runtimeKind: RuntimeKind;
  availableRuntimes: RuntimeKind[];
  onSend: (prompt: string, attachments?: PromptAttachment[]) => Promise<void>;
  onCancel: (runId: string) => void;
  onApproval: (
    item: ApprovalTimelineItem,
    approved: boolean,
  ) => Promise<void>;
  onApprovalModeChange: (mode: ApprovalMode) => Promise<void>;
  onRuntimeChange: (runtime: RuntimeKind) => void;
  runtimeError?: string | null;
  onDismissRuntimeError?: () => void;
  onReviewTurnChanges?: (runId: string) => void;
  runtimeSwitching?: boolean;
  runtimeSwitchTarget?: RuntimeKind | null;
}) {
  const {
    sessionId,
    items,
    runs,
    liveMessageIds,
    onMessagePresented,
    modelLabel,
    workspaceReady,
    workspaceRoot,
    activeRunId,
    approvalMode,
    runtimeKind,
    availableRuntimes,
    onSend,
    onCancel,
    onApproval,
    onApprovalModeChange,
    onRuntimeChange,
    runtimeError,
    onDismissRuntimeError,
    onReviewTurnChanges,
    runtimeSwitching,
    runtimeSwitchTarget,
  } = props;
  const [prompt, setPrompt] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const attachmentsEnabled = runtimeKind === "native";
  const attachmentSessionId = sessionId ?? "draft";
  const attachments = useAttachmentsStore(
    (state) => state.pending[attachmentSessionId] ?? EMPTY_ATTACHMENTS,
  );
  const clearAttachments = useAttachmentsStore((state) => state.clear);
  const hasAttachments = attachments.length > 0;
  const canAttachImages = attachmentsEnabled && Boolean(workspaceRoot);
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
        item.kind === "approval" &&
        item.status === "pending" &&
        item.approval.tool.trim().toLowerCase() !== "exit_plan_mode",
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
    if ((!value && !hasAttachments) || activeRunId || !workspaceReady) return;
    const outgoingAttachments = toPromptAttachments(attachmentSessionId);
    setPrompt("");
    setSendError(null);
    shouldFollowRef.current = true;
    if (outgoingAttachments.length > 0) {
      clearAttachments(attachmentSessionId);
    }
    try {
      await onSend(
        value,
        outgoingAttachments.length > 0 ? outgoingAttachments : undefined,
      );
    } catch (error) {
      setPrompt(value);
      setSendError(error instanceof Error ? error.message : String(error));
    }
  }

  const handleImageFiles = useCallback(
    (files: File[]) => {
      if (!canAttachImages || !workspaceRoot) return;
      void saveImageFiles(attachmentSessionId, workspaceRoot, files);
    },
    [attachmentSessionId, canAttachImages, workspaceRoot],
  );

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canAttachImages) return;
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return;
    const images: File[] = [];
    for (const item of items) {
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) images.push(file);
    }
    if (images.length === 0) return;
    event.preventDefault();
    handleImageFiles(images);
  };

  const onDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!canAttachImages) return;
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!canAttachImages) return;
    const images = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length === 0) return;
    event.preventDefault();
    handleImageFiles(images);
  };

  async function pickImages() {
    if (!canAttachImages || !workspaceRoot) return;
    const picked = await window.piLing.pickAttachmentImages(workspaceRoot);
    if (picked.length > 0) {
      useAttachmentsStore.getState().add(attachmentSessionId, picked);
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
    const turnParts: ReactNode[] = [];

    if (activity.hasActivity) {
      turnParts.push(
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
        turnParts.push(
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
      const turnFiles = changesFilesByRunId(items, activity.runId, {
        editToolsOnly: true,
      });
      if (
        turnFiles.length > 0 &&
        activity.viewMode === "settled" &&
        complete &&
        props.onReviewTurnChanges
      ) {
        turnParts.push(
          <TurnChangesCard
            files={turnFiles}
            onReview={() => props.onReviewTurnChanges?.(activity.runId)}
            key={`${activity.runId}:turn-changes`}
          />,
        );
      }
    }

    if (turnParts.length === 0 && !activity.user) continue;

    rendered.push(
      <TurnBlock
        key={`${activity.runId}:turn`}
        {...(activity.user ? { user: activity.user } : {})}
        workspaceRoot={workspaceRoot}
      >
        {turnParts}
      </TurnBlock>,
    );
  }

  return (
    <section className="content" aria-label="会话">
      <div
        className={`message-list${
          pendingApprovals.length > 0 ? " has-composer-overlay" : ""
        }`}
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
        <div
          className={`composer-stack${
            pendingApprovals.length > 0 ? " has-approval-overlay" : ""
          }`}
        >
          <form
            className="composer"
            onSubmit={submit}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
          {workspaceRoot && hasAttachments ? (
            <AttachmentChips
              sessionId={attachmentSessionId}
              workspaceRoot={workspaceRoot}
            />
          ) : null}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onPaste={onPaste}
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
          {runtimeError ? (
            <div className="message-error">
              {runtimeError}
              {onDismissRuntimeError ? (
                <button
                  type="button"
                  className="message-error-dismiss"
                  aria-label="关闭"
                  onClick={onDismissRuntimeError}
                >
                  ×
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="composer-footer">
            <div className="composer-controls">
              {canAttachImages ? (
                <button
                  type="button"
                  className="composer-attach-button"
                  aria-label="上传图片"
                  disabled={Boolean(activeRunId)}
                  onClick={() => {
                    void pickImages();
                  }}
                >
                  <ImagePlus size={16} />
                </button>
              ) : null}
              <RuntimePicker
                value={runtimeKind}
                available={availableRuntimes}
                disabled={Boolean(activeRunId)}
                switching={Boolean(runtimeSwitching)}
                switchingTo={runtimeSwitchTarget ?? null}
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
                disabled={(!prompt.trim() && !hasAttachments) || !workspaceReady}
              >
                <ArrowUp />
              </button>
            )}
          </div>
        </form>
          <ApprovalDock
            approvals={pendingApprovals}
            onDecision={(approval, approved) => {
              void onApproval(approval, approved);
            }}
          />
        </div>
      </div>
    </section>
  );
}
