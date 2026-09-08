import { create } from "zustand";

import type { PromptAttachment, SavedAttachmentImage } from "@pi-ling/contracts";

export interface AttachedImage extends PromptAttachment {}

interface AttachmentsStore {
  pending: Record<string, AttachedImage[]>;
  add: (sessionId: string, items: SavedAttachmentImage[]) => void;
  remove: (sessionId: string, id: string) => void;
  clear: (sessionId: string) => void;
}

let seq = 0;
const nextId = () => `att-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const useAttachmentsStore = create<AttachmentsStore>((set, get) => ({
  pending: {},

  add: (sessionId, items) => {
    if (items.length === 0) return;
    const current = get().pending[sessionId] ?? [];
    const seen = new Set(current.map((file) => file.relativePath));
    const added: AttachedImage[] = [];
    for (const item of items) {
      if (seen.has(item.relativePath)) continue;
      seen.add(item.relativePath);
      added.push({
        id: nextId(),
        relativePath: item.relativePath,
        name: item.name,
        mediaType: item.mediaType,
      });
    }
    if (added.length === 0) return;
    set({
      pending: {
        ...get().pending,
        [sessionId]: [...current, ...added],
      },
    });
  },

  remove: (sessionId, id) => {
    const current = get().pending[sessionId] ?? [];
    const next = current.filter((file) => file.id !== id);
    const map = { ...get().pending };
    if (next.length === 0) delete map[sessionId];
    else map[sessionId] = next;
    set({ pending: map });
  },

  clear: (sessionId) => {
    const map = { ...get().pending };
    delete map[sessionId];
    set({ pending: map });
  },
}));

export async function saveImageFiles(
  sessionId: string,
  workspaceRoot: string,
  files: File[],
): Promise<void> {
  const saved: SavedAttachmentImage[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await window.piLing.saveAttachmentImage(
        workspaceRoot,
        bytes,
        file.type,
        file.name || undefined,
      );
      saved.push(result);
    } catch (error) {
      console.error("[attach] saveAttachmentImage failed for", file.name, error);
    }
  }
  if (saved.length > 0) {
    useAttachmentsStore.getState().add(sessionId, saved);
  }
}

export function toPromptAttachments(
  sessionId: string,
): PromptAttachment[] {
  return (useAttachmentsStore.getState().pending[sessionId] ?? []).map(
    ({ id, relativePath, name, mediaType }) => ({
      id,
      relativePath,
      name,
      mediaType,
    }),
  );
}
