import { Brain } from "lucide-react";

import type {
  AssistantTimelineItem,
  UserTimelineItem,
} from "../../timeline/reducer";
import { formatMessageUsage } from "./format-message-usage";
import { Markdown } from "./Markdown";
import { UserAttachmentChips } from "./UserAttachmentChips";

export function MessageItem(props: {
  item: UserTimelineItem | AssistantTimelineItem;
  hideThinking?: boolean;
  workspaceRoot?: string;
}) {
  const { item } = props;
  if (item.kind === "user") {
    return (
      <article className="message user">
        {item.attachments && item.attachments.length > 0 ? (
          <UserAttachmentChips
            attachments={item.attachments}
            workspaceRoot={props.workspaceRoot}
          />
        ) : null}
        {item.text ? <div className="message-text">{item.text}</div> : null}
      </article>
    );
  }

  const usageLabel =
    item.kind === "assistant"
      ? formatMessageUsage({
          ...(item.usage ? { usage: item.usage } : {}),
          ...(item.contextUsage ? { contextUsage: item.contextUsage } : {}),
        })
      : null;

  return (
    <article className="message assistant">
      {item.thinking && !props.hideThinking ? (
        <details className="message-thinking">
          <summary>
            <Brain />
            思考过程
          </summary>
          <div>{item.thinking}</div>
        </details>
      ) : null}
      {item.text ? (
        <Markdown streaming={item.status === "streaming"}>
          {item.text}
        </Markdown>
      ) : item.status === "streaming" ? (
        <span className="streaming-cursor" aria-label="正在生成" />
      ) : null}
      {item.error ? <div className="message-error">{item.error}</div> : null}
      {usageLabel ? <div className="message-usage">{usageLabel}</div> : null}
    </article>
  );
}
