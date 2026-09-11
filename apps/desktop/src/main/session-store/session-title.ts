export const DEFAULT_SESSION_TITLE = "新对话";

export function deriveSessionTitle(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (!singleLine) return DEFAULT_SESSION_TITLE;
  return singleLine.length > 48 ? `${singleLine.slice(0, 45)}…` : singleLine;
}

export function isPlaceholderSessionTitle(
  title: string,
  workspaceName: string,
): boolean {
  const normalized = title.trim();
  return (
    normalized === DEFAULT_SESSION_TITLE ||
    normalized === "New chat" ||
    normalized === workspaceName
  );
}

export function userMessageText(message: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return message.content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text!)
    .join("\n")
    .trim();
}
