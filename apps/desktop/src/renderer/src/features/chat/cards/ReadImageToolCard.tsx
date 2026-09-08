import { useFilesStore } from "../../files/store";
import type { ToolTimelineItem } from "../../../timeline/reducer";
import { ToolCardShell } from "./tool-card-shell";

function imagePath(arguments_: Record<string, unknown>): string | undefined {
  for (const key of ["path", "file_path", "filePath", "file"]) {
    const value = arguments_[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function ReadImageToolCard(props: { item: ToolTimelineItem }) {
  const openFile = useFilesStore((state) => state.openFile);
  const path = imagePath(props.item.arguments);

  return (
    <ToolCardShell item={props.item}>
      {path ? (
        <button
          type="button"
          className="tool-read-image-open"
          onClick={() => openFile(path)}
        >
          在 Files 中预览 {path}
        </button>
      ) : (
        <p className="tool-rich-empty">No image path in tool arguments.</p>
      )}
    </ToolCardShell>
  );
}
