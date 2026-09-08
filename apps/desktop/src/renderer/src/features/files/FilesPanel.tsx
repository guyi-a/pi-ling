import { FilePreview } from "./FilePreview";
import { useFilesStore } from "./store";
import { WorkspaceTree } from "./WorkspaceTree";

export function FilesPanel(props: { root?: string | undefined }) {
  const previewPath = useFilesStore((state) => state.previewPath);

  if (!props.root) {
    return (
      <div className="files-empty">
        <strong>Files</strong>
        <p>选择工作区后，可在此浏览文件并预览内容（仅只读）。</p>
      </div>
    );
  }

  return (
    <aside className="files-view" aria-label="Files">
      {previewPath ? (
        <FilePreview root={props.root} path={previewPath} />
      ) : (
        <WorkspaceTree root={props.root} />
      )}
    </aside>
  );
}
