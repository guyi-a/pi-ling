import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import type {
  ApprovalTimelineItem,
  TimelineItem,
  ToolTimelineItem,
} from "../../timeline/reducer";
import { ApprovalCard } from "./ApprovalCard";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { MessageItem } from "./MessageItem";
import { ToolCard } from "./ToolCard";

export function ChatView(props: {
  items: TimelineItem[];
  modelLabel: string;
  workspaceReady: boolean;
  activeRunId: string | null;
  onSend: (prompt: string) => Promise<void>;
  onCancel: (runId: string) => void;
  onApproval: (
    item: ApprovalTimelineItem,
    approved: boolean,
  ) => Promise<void>;
}) {
  const {
    items,
    modelLabel,
    workspaceReady,
    activeRunId,
    onSend,
    onCancel,
    onApproval,
  } = props;
  const [prompt, setPrompt] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = prompt.trim();
    if (!value || activeRunId || !workspaceReady) {
      return;
    }
    setPrompt("");
    await onSend(value);
  }

  const rendered: ReactNode[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.kind === "changes") {
      continue;
    }
    if (item.kind === "user") {
      rendered.push(<MessageItem item={item} key={item.id} />);
      continue;
    }
    if (item.kind === "approval") {
      rendered.push(
        <ApprovalCard
          item={item}
          key={item.id}
          onDecision={(approval, approved) => {
            void onApproval(approval, approved);
          }}
        />,
      );
      continue;
    }
    if (item.kind === "assistant" && item.stopReason === "toolUse") {
      const tools: ToolTimelineItem[] = [];
      while (items[index + 1]?.kind === "tool") {
        tools.push(items[index + 1] as ToolTimelineItem);
        index += 1;
      }
      rendered.push(
        <ExecutionTimeline assistant={item} tools={tools} key={item.id} />,
      );
      continue;
    }
    if (item.kind === "assistant") {
      rendered.push(<MessageItem item={item} key={item.id} />);
      continue;
    }
    if (item.kind === "tool") {
      rendered.push(<ToolCard item={item} key={item.id} />);
    }
  }

  return (
    <section className="content" aria-label="Session workspace">
      <div className="message-list" aria-live="polite">
        {rendered}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <div className="model-status">{modelLabel}</div>
        <div className="composer-row">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask pi-ling to inspect or change the workspace"
            rows={2}
            disabled={!workspaceReady}
          />
          {activeRunId ? (
            <button
              className="send-button"
              type="button"
              onClick={() => onCancel(activeRunId)}
            >
              Stop
            </button>
          ) : (
            <button
              className="send-button"
              type="submit"
              disabled={!prompt.trim() || !workspaceReady}
            >
              Send
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
