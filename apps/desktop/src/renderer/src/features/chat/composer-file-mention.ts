import type { WorkspaceTreeNode } from "@pi-ling/contracts";

export type ActiveMentionToken = {
  start: number;
  end: number;
  query: string;
};

const MENTION_TOKEN_PATTERN = /@([^\s@]*)$/;

export function parseActiveMentionToken(
  text: string,
  cursorIndex: number,
): ActiveMentionToken | null {
  const beforeCursor = text.slice(0, cursorIndex);
  const match = beforeCursor.match(MENTION_TOKEN_PATTERN);
  if (!match || match.index === undefined) {
    return null;
  }
  return {
    start: match.index,
    end: cursorIndex,
    query: match[1] ?? "",
  };
}

export function insertMentionAtToken(
  text: string,
  token: ActiveMentionToken,
  relativePath: string,
): { nextText: string; nextCursor: number } {
  const mention = `@${relativePath} `;
  const nextText =
    text.slice(0, token.start) + mention + text.slice(token.end);
  return {
    nextText,
    nextCursor: token.start + mention.length,
  };
}

export function filterWorkspaceFilesForMention(
  entries: readonly WorkspaceTreeNode[],
  query: string,
  limit = 50,
): WorkspaceTreeNode[] {
  const normalized = query.trim().toLowerCase();
  const files = entries.filter((entry) => entry.kind === "file");
  if (!normalized) {
    return files.slice(0, limit);
  }
  return files
    .filter(
      (entry) =>
        entry.path.toLowerCase().includes(normalized) ||
        entry.name.toLowerCase().includes(normalized),
    )
    .slice(0, limit);
}
