import type { ToolTimelineItem } from "../../timeline/reducer";

export function ToolCard({ item }: { item: ToolTimelineItem }) {
  return (
    <div className={`tool-card ${item.status}`}>
      <div className="tool-card-header">
        <strong>{item.tool}</strong>
        <span>{item.status}</span>
      </div>
      <code>{JSON.stringify(item.arguments)}</code>
      {item.output ? (
        <details className="tool-output">
          <summary>Output</summary>
          <pre>{item.output}</pre>
        </details>
      ) : null}
    </div>
  );
}
