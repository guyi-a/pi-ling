import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ImagePlus,
  Square,
} from "lucide-react";
import type {
  ApprovalMode,
  ComposerMode,
  PromptAttachment,
  RuntimeKind,
} from "@pi-ling/contracts";
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
  QuestionTimelineItem,
  TimelineItem,
  TimelineRun,
} from "../../timeline/reducer";
import { projectRunActivities } from "../../run-activity/project-run-activity";
import { changesFilesByRunId } from "../../run-activity/run-changes";
import { ApprovalModePicker } from "./ApprovalModePicker";
import { ApprovalDock } from "./ApprovalDock";
import { QuestionDock } from "./QuestionDock";
import { AttachmentChips } from "./AttachmentChips";
import {
  saveImageFiles,
  toPromptAttachments,
  useAttachmentsStore,
} from "./attachments-store";
import { CompactionMarker } from "./CompactionMarker";
import { MessageItem } from "./MessageItem";
import { RunActivityBlock } from "./RunActivityBlock";
import { TurnBlock } from "./TurnBlock";
import { TurnChangesCard } from "./TurnChangesCard";
import { ComposerModePicker } from "./ComposerModePicker";
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

type ComposerMenu = "runtime" | "approval" | "composer";

export function ChatView(props: {
  sessionId: string | null;
  items: TimelineItem[];
  runs: Record<string, TimelineRun>;
  liveMessageIds: ReadonlySet<string>;
  onMessagePresented: (messageId: string) => void;
  workspaceReady: boolean;
  configured: boolean;
  workspaceRoot?: string;
  activeRunId: string | null;
  approvalMode: ApprovalMode;
  composerMode: ComposerMode;
  runtimeKind: RuntimeKind;
  availableRuntimes: RuntimeKind[];
  onSend: (prompt: string, attachments?: PromptAttachment[]) => Promise<void>;
  onCancel: (runId: string) => void;
  onApproval: (
    item: ApprovalTimelineItem,
    approved: boolean,
  ) => Promise<void>;
  onQuestion: (
    item: QuestionTimelineItem,
    answers: import("@pi-ling/contracts").AskUserAnswer[],
  ) => Promise<void>;
  onApprovalModeChange: (mode: ApprovalMode) => Promise<void>;
  onComposerModeChange: (mode: ComposerMode) => Promise<void>;
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
    workspaceReady,
    configured,
    workspaceRoot,
    activeRunId,
    approvalMode,
    composerMode,
    runtimeKind,
    availableRuntimes,
    onSend,
    onCancel,
    onApproval,
    onQuestion,
    onApprovalModeChange,
    onComposerModeChange,
    onRuntimeChange,
    runtimeError,
    onDismissRuntimeError,
    onReviewTurnChanges,
    runtimeSwitching,
    runtimeSwitchTarget,
  } = props;
  const [prompt, setPrompt] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [openComposerMenu, setOpenComposerMenu] = useState<ComposerMenu | null>(
    null,
  );
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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [skippedPresentationRunIds, setSkippedPresentationRunIds] =
    useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setSkippedPresentationRunIds(new Set());
  }, [sessionId]);
  const fastForwardRunIds = useMemo(() => {
    const runIds = immediatePresentationRunIds(items, runs);
    for (const runId of skippedPresentationRunIds) {
      runIds.add(runId);
    }
    return runIds;
  }, [items, runs, skippedPresentationRunIds]);
  const presentation = useMessagePresentation({
    sessionId,
    items,
    runs,
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
  const pendingQuestions = items
    .filter(
      (item): item is QuestionTimelineItem =>
        item.kind === "question" && item.status === "pending",
    )
    .sort((left, right) => left.createdSeq - right.createdSeq);
  const composerOverlay =
    pendingQuestions.length > 0 || pendingApprovals.length > 0;
  const presentationBusy =
    presentation.presentingMessageIds.size > 0 ||
    Boolean(presentation.currentToolId);
  const composerBusy = Boolean(activeRunId) || presentationBusy;

  const updateScrollAffordance = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distance =
      node.scrollHeight - node.scrollTop - node.clientHeight;
    setShowScrollToBottom(distance > 80);
  }, []);

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    setShowScrollToBottom(false);
  }, []);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(updateScrollAffordance);
    return () => cancelAnimationFrame(frame);
  }, [items, presentation.revision, updateScrollAffordance]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [prompt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if ((!value && !hasAttachments) || composerBusy || !workspaceReady) return;
    const outgoingAttachments = toPromptAttachments(attachmentSessionId);
    setPrompt("");
    setSendError(null);
    requestAnimationFrame(scrollToBottom);
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

  const renderedUnits: Array<{ seq: number; node: ReactNode }> = [];
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

    const runSeq = items
      .filter((item) => item.runId === activity.runId)
      .reduce(
        (min, item) => Math.min(min, item.createdSeq),
        Number.POSITIVE_INFINITY,
      );
    renderedUnits.push({
      seq: runSeq,
      node: (
        <TurnBlock
          key={`${activity.runId}:turn`}
          {...(activity.user ? { user: activity.user } : {})}
          workspaceRoot={workspaceRoot}
        >
          {turnParts}
        </TurnBlock>
      ),
    });
  }

  for (const marker of items) {
    if (marker.kind !== "compaction") continue;
    renderedUnits.push({
      seq: marker.createdSeq,
      node: <CompactionMarker item={marker} key={marker.id} />,
    });
  }

  renderedUnits.sort((left, right) => left.seq - right.seq);
  const rendered = renderedUnits.map((unit) => unit.node);

  return (
    <section className="content" aria-label="会话">
      <div className="chat-column">
      <div className="message-list-area">
        <div
          className={`message-list${composerOverlay ? " has-composer-overlay" : ""}`}
          ref={scrollRef}
          onScroll={updateScrollAffordance}
        >
          <div className="message-list-inner">
            {rendered.length > 0 ? (
              rendered
            ) : (
              <div className="empty-conversation" aria-label="空会话" />
            )}
          </div>
        </div>
        {showScrollToBottom ? (
          <button
            type="button"
            className="scroll-to-bottom"
            aria-label="回到底部"
            onClick={scrollToBottom}
          >
            <ArrowDown size={16} />
          </button>
        ) : null}
      </div>

      <div className="composer-wrap">
        <div
          className={`composer-stack${
            composerOverlay ? " has-approval-overlay has-question-overlay" : ""
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
              !workspaceReady
                ? "请先选择一个工作区"
                : !configured
                  ? "缺少 DEEPSEEK_API_KEY"
                  : "描述你想完成的任务"
            }
            rows={1}
            disabled={!workspaceReady || composerBusy}
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
                  disabled={composerBusy}
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
                disabled={composerBusy}
                open={openComposerMenu === "runtime"}
                onOpenChange={(open) => {
                  setOpenComposerMenu(open ? "runtime" : null);
                }}
                switching={Boolean(runtimeSwitching)}
                switchingTo={runtimeSwitchTarget ?? null}
                onChange={onRuntimeChange}
              />
              <ApprovalModePicker
                value={approvalMode}
                disabled={!workspaceReady || composerBusy}
                open={openComposerMenu === "approval"}
                onOpenChange={(open) => {
                  setOpenComposerMenu(open ? "approval" : null);
                }}
                onChange={onApprovalModeChange}
              />
              <ComposerModePicker
                value={composerMode}
                runtimeKind={runtimeKind}
                disabled={!workspaceReady || composerBusy}
                open={openComposerMenu === "composer"}
                onOpenChange={(open) => {
                  setOpenComposerMenu(open ? "composer" : null);
                }}
                onChange={onComposerModeChange}
              />
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
            ) : presentationBusy ? (
              <button
                className="send-button skip"
                type="button"
                aria-label="跳过动画"
                onClick={() => {
                  setSkippedPresentationRunIds((current) => {
                    const next = new Set(current);
                    for (const runId of presentation.presentingRunIds) {
                      next.add(runId);
                    }
                    return next;
                  });
                }}
              >
                <ChevronsDown />
              </button>
            ) : (
              <button
                className="send-button"
                type="submit"
                aria-label="发送"
                disabled={
                  (!prompt.trim() && !hasAttachments) || !workspaceReady
                }
              >
                <ArrowUp />
              </button>
            )}
          </div>
        </form>
          {pendingQuestions[0] ? (
            <QuestionDock
              question={pendingQuestions[0]}
              onSubmit={(answers) => {
                void onQuestion(pendingQuestions[0], answers);
              }}
            />
          ) : (
            <ApprovalDock
              approvals={pendingApprovals}
              onDecision={(approval, approved) => {
                void onApproval(approval, approved);
              }}
            />
          )}
        </div>
      </div>
      </div>
    </section>
  );
}
