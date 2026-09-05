import { ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  AssistantTimelineItem,
  ToolTimelineItem,
} from "../../timeline/reducer";
import { ToolCard } from "./ToolCard";

export function ExecutionTimeline(props: {
  assistant: AssistantTimelineItem;
  tools: ToolTimelineItem[];
}) {
  const { assistant, tools } = props;
  const active =
    assistant.status === "streaming" ||
    tools.some((tool) =>
      ["requested", "awaiting-approval", "running"].includes(tool.status),
    );
  const [open, setOpen] = useState(active);

  useEffect(() => {
    if (active) {
      setOpen(true);
    }
  }, [active]);

  return (
    <details
      className="execution-timeline"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ChevronRight className="execution-chevron" />
        {active ? (
          <LoaderCircle className="execution-spinner" />
        ) : null}
        {active ? "正在执行" : "执行过程"}
      </summary>
      <div className="execution-content">
        {assistant.thinking ? (
          <div className="execution-thinking">{assistant.thinking}</div>
        ) : null}
        {assistant.text ? (
          <div className="execution-text">{assistant.text}</div>
        ) : null}
        {tools.map((tool) => (
          <ToolCard item={tool} key={tool.id} />
        ))}
      </div>
    </details>
  );
}
