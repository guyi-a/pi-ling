import type { TimelineUserAttachment } from "@pi-ling/contracts";

export function resolveUserMessageCopyText(item: {
  text?: string;
  attachments?: TimelineUserAttachment[];
}): string {
  const parts: string[] = [];
  const text = item.text?.trim();
  if (text) {
    parts.push(text);
  }
  if (item.attachments && item.attachments.length > 0) {
    const names = item.attachments.map((attachment) => attachment.name).join(", ");
    parts.push(`[附件: ${names}]`);
  }
  return parts.join("\n\n");
}

export function resolveAssistantMessageCopyText(
  item: {
    text?: string;
    thinking?: string;
  },
  options?: { includeThinking?: boolean },
): string {
  const parts: string[] = [];
  if (options?.includeThinking) {
    const thinking = item.thinking?.trim();
    if (thinking) {
      parts.push(thinking);
    }
  }
  const text = item.text?.trim();
  if (text) {
    parts.push(text);
  }
  return parts.join("\n\n");
}
