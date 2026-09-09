const LONG_TEXT_CHARS = 120;
const LONG_TEXT_LINES = 3;

export function isLongUserPromptText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length > LONG_TEXT_CHARS) return true;
  return trimmed.split("\n").length > LONG_TEXT_LINES;
}
