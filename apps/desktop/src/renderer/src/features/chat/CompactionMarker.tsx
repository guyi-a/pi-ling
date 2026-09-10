import type { CompactionTimelineItem } from "../../timeline/reducer";

export function CompactionMarker(props: { item: CompactionTimelineItem }) {
  return (
    <div className="compaction-marker" role="note">
      <span className="compaction-marker-line" aria-hidden="true" />
      <span className="compaction-marker-label">
        上下文已压缩 · 共折叠 {props.item.replacedCount} 条消息
      </span>
      <span className="compaction-marker-line" aria-hidden="true" />
    </div>
  );
}
