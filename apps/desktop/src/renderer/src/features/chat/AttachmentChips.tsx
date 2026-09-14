import { X } from "lucide-react";

import { workspaceInlineURL } from "../../lib/workspace-url";
import { useFilesStore } from "../files/store";
import {
  useAttachmentsStore,
  type AttachedImage,
} from "./attachments-store";

function AttachmentChip(props: {
  file: AttachedImage;
  workspaceRoot: string;
  onRemove: () => void;
}) {
  const requestOpenFile = useFilesStore((state) => state.requestOpenFile);
  const src = workspaceInlineURL(props.workspaceRoot, props.file.relativePath);
  return (
    <div className="attachment-chip">
      <button
        type="button"
        className="attachment-chip-preview"
        aria-label={`预览 ${props.file.name}`}
        title={props.file.name}
        onClick={() => requestOpenFile(props.file.relativePath)}
      >
        <img
          className="attachment-chip-thumb"
          src={src}
          alt=""
        />
      </button>
      <button
        type="button"
        className="attachment-chip-remove"
        aria-label={`移除 ${props.file.name}`}
        onClick={(event) => {
          event.stopPropagation();
          props.onRemove();
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function AttachmentChips(props: {
  sessionId: string;
  workspaceRoot: string;
}) {
  const files = useAttachmentsStore(
    (state) => state.pending[props.sessionId] ?? [],
  );
  const remove = useAttachmentsStore((state) => state.remove);
  if (files.length === 0) return null;
  return (
    <div className="attachment-chips" aria-label="待发送图片">
      {files.map((file) => (
        <AttachmentChip
          key={file.id}
          file={file}
          workspaceRoot={props.workspaceRoot}
          onRemove={() => remove(props.sessionId, file.id)}
        />
      ))}
    </div>
  );
}
