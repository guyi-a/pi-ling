import { useState } from "react";

import type { UserTimelineItem } from "../../timeline/reducer";
import { UserAttachmentChips } from "./UserAttachmentChips";
import { isLongUserPromptText } from "./user-turn-prompt";

export function UserTurnPrompt(props: {
  item: UserTimelineItem;
  workspaceRoot?: string;
}) {
  const { item } = props;
  const [expanded, setExpanded] = useState(false);
  const hasText = Boolean(item.text?.trim());
  const hasAttachments = Boolean(item.attachments && item.attachments.length > 0);
  const isLong = hasText && isLongUserPromptText(item.text);

  if (!hasText && !hasAttachments) return null;

  return (
    <header
      className={`user-turn-prompt ${expanded ? "is-expanded" : ""} ${
        isLong ? "is-collapsible" : ""
      }`}
      aria-label="用户消息"
    >
      {hasAttachments ? (
        <UserAttachmentChips
          attachments={item.attachments!}
          workspaceRoot={props.workspaceRoot}
        />
      ) : null}
      {hasText ? (
        <div className="user-turn-prompt-text">{item.text}</div>
      ) : null}
      {isLong ? (
        <button
          className="user-turn-prompt-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      ) : null}
    </header>
  );
}
