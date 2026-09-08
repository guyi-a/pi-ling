import { useFilesStore } from "../../files/store";
import { useAgentWorkspaceRoot } from "../../../hooks/use-agent-workspace-root";
import type { ToolTimelineItem } from "../../../timeline/reducer";
import { workspaceDownloadURL } from "../../../lib/workspace-url";
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
  const workspaceRoot = useAgentWorkspaceRoot();
  const path = imagePath(props.item.arguments);
  const previewSrc =
    path && workspaceRoot
      ? workspaceDownloadURL(workspaceRoot, path)
      : undefined;

  return (
    <ToolCardShell item={props.item}>
      {path ? (
        <div className="tool-read-image-body">
          {previewSrc ? (
            <img
              className="tool-read-image-preview"
              src={previewSrc}
              alt={path}
            />
          ) : null}
          <button
            type="button"
            className="tool-read-image-open"
            onClick={() => openFile(path)}
          >
            在 Files 中预览 {path}
          </button>
        </div>
      ) : (
        <p className="tool-rich-empty">No image path in tool arguments.</p>
      )}
    </ToolCardShell>
  );
}
