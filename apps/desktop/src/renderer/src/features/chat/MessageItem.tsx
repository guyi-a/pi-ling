import { Brain } from "lucide-react";

import type {
  AssistantTimelineItem,
  UserTimelineItem,
} from "../../timeline/reducer";
import { Markdown } from "./Markdown";

export function MessageItem(props: {
  item: UserTimelineItem | AssistantTimelineItem;
}) {
  const { item } = props;
  if (item.kind === "user") {
    return (
      <article className="message user">
        <div className="message-text">{item.text}</div>
      </article>
    );
  }

  return (
    <article className="message assistant">
      <div className="message-role">
        <span className="message-role-icon">π</span>
        pi-ling
      </div>
      {item.thinking ? (
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
      {item.usage ? (
        <div className="message-usage">
          {item.usage.input} 输入 · {item.usage.output} 输出 ·{" "}
          {item.usage.totalTokens} tokens
        </div>
      ) : null}
    </article>
  );
}
