import { X } from "lucide-react";

import { workspaceInlineURL } from "../../lib/workspace-url";
import {
  useAttachmentsStore,
  type AttachedImage,
} from "./attachments-store";

function AttachmentChip(props: {
  file: AttachedImage;
  workspaceRoot: string;
  onRemove: () => void;
}) {
  const src = workspaceInlineURL(props.workspaceRoot, props.file.relativePath);
  return (
    <div className="attachment-chip">
      <img
        className="attachment-chip-thumb"
        src={src}
        alt={props.file.name}
        title={props.file.name}
      />
      <span className="attachment-chip-name">{props.file.name}</span>
      <button
        type="button"
        className="attachment-chip-remove"
        aria-label={`移除 ${props.file.name}`}
        onClick={props.onRemove}
      >
        <X size={14} />
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
