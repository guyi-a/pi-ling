import type {
  AssistantTimelineItem,
  UserTimelineItem,
} from "../../timeline/reducer";

export function MessageItem(props: {
  item: UserTimelineItem | AssistantTimelineItem;
}) {
  const { item } = props;
  if (item.kind === "user") {
    return (
      <article className="message user">
        <div className="message-role">You</div>
        <div className="message-text">{item.text}</div>
      </article>
    );
  }

  return (
    <article className="message assistant">
      <div className="message-role">pi-ling</div>
      {item.thinking ? (
        <details className="thinking">
          <summary>Thinking</summary>
          <div>{item.thinking}</div>
        </details>
      ) : null}
      <div className="message-text">
        {item.text || (item.status === "streaming" ? "Thinking…" : "")}
      </div>
      {item.error ? <div className="message-error">{item.error}</div> : null}
      {item.usage ? (
        <div className="message-usage">
          {item.usage.input} in · {item.usage.output} out ·{" "}
          {item.usage.totalTokens} total
        </div>
      ) : null}
    </article>
  );
}
