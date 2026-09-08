import { ChevronRight } from "lucide-react";
import { useState } from "react";

export function ThinkingCard(props: {
  content: string;
  streaming: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!props.content) return null;
  const expandable = true;
  return (
    <div className={`thinking-card ${open ? "expanded" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        disabled={!expandable}
        onClick={() => setOpen((current) => !current)}
      >
        {expandable ? <ChevronRight /> : <span className="thinking-spacer" />}
        <span className="thinking-indicator" />
        {props.streaming ? "Thinking" : "Thoughts"}
      </button>
      {open && expandable ? (
        <div className="thinking-card-content">{props.content}</div>
      ) : null}
    </div>
  );
}
