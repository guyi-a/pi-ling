import type { CodexThreadItem } from "./codex-app-server-types.js";

export function normalizeCodexCommandTool(command: string): {
  title: string;
  path?: string;
} | undefined {
  const contentCommand = command.match(
    /(?:Add|Set)-Content(?:[^;\n]*?)(?:-LiteralPath|-Path)\s+['"]?([^'"\s;]+)/i,
  );
  if (contentCommand?.[1]) {
    return { title: "write_file", path: contentCommand[1] };
  }
  if (/apply_patch|Begin Patch|\*\*\* Update File:/i.test(command)) {
    const update = command.match(
      /\*\*\* Update File:\s*(.+?)(?=\\n|\r?\n|\*\*\*|$)/i,
    );
    const add = command.match(
      /\*\*\* Add File:\s*(.+?)(?=\\n|\r?\n|\*\*\*|$)/i,
    );
    const rawPath = update?.[1] ?? add?.[1];
    const path = rawPath?.trim().replace(/^["']|["']$/g, "");
    return {
      title: update ? "edit_file" : "write_file",
      ...(path ? { path } : {}),
    };
  }
  return undefined;
}

export function codexToolTitle(item: CodexThreadItem): string {
  switch (item.type) {
    case "commandExecution":
      return normalizeCodexCommandTool(item.command ?? "")?.title ??
        "run_command";
    case "fileChange":
      return item.changes?.some((change) => change.kind === "update")
        ? "edit_file"
        : "write_file";
    case "webSearch":
      return "web_search";
    case "mcpToolCall":
      return `mcp_${item.server ?? "server"}_${item.tool ?? "tool"}`;
    case "dynamicToolCall":
      return item.tool ?? "dynamic_tool";
    case "plan":
      return "update_plan";
    default:
      return item.type;
  }
}

export function codexToolKind(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (["read", "read_file"].includes(normalized)) return "read";
  if (["glob", "grep", "search", "web_search"].includes(normalized)) {
    return "search";
  }
  if (["write", "write_file", "edit", "edit_file"].includes(normalized)) {
    return "edit";
  }
  if (["bash", "run_command", "command_execution"].includes(normalized)) {
    return "execute";
  }
  return "other";
}

export function codexToolInput(item: CodexThreadItem): unknown {
  switch (item.type) {
    case "commandExecution": {
      const command = item.command ?? "";
      const normalized = normalizeCodexCommandTool(command);
      return normalized?.path
        ? { command, path: normalized.path }
        : { command, ...(item.cwd ? { cwd: item.cwd } : {}) };
    }
    case "fileChange":
      return { changes: item.changes ?? [] };
    case "webSearch":
      return { query: item.query ?? "" };
    case "mcpToolCall":
      return {
        server: item.server,
        tool: item.tool,
        arguments: item.arguments,
      };
    case "dynamicToolCall":
      return item.arguments;
    case "plan":
      return { plan: item.text ?? "" };
    default:
      return item.arguments;
  }
}

export function codexToolOutput(
  item: CodexThreadItem,
): string | undefined {
  switch (item.type) {
    case "commandExecution":
      return item.aggregatedOutput ?? undefined;
    case "mcpToolCall":
      return item.error?.message ?? JSON.stringify(item.result ?? {});
    case "dynamicToolCall":
      return item.contentItems
        ? JSON.stringify(item.contentItems)
        : undefined;
    default:
      return undefined;
  }
}
