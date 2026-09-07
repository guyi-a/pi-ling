import type { ToolTimelineItem } from "../timeline/reducer";

export type ToolCategory = "explore" | "edit" | "command" | "verify" | "other";

function normalizedName(name: string): string {
  return name.toLowerCase().replaceAll(/[\s-]+/g, "_");
}

export function toolTarget(tool: ToolTimelineItem): string {
  for (const key of ["path", "file", "file_path", "filePath", "command", "pattern", "query", "url"]) {
    const value = tool.arguments[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return tool.tool;
}

export function classifyTool(tool: ToolTimelineItem): ToolCategory {
  const name = normalizedName(tool.tool);
  const target = toolTarget(tool).toLowerCase();
  if (
    /(test|vitest|jest|lint|typecheck|verify|build)/.test(target) &&
    /(command|shell|bash|pwsh|terminal|execute|run)/.test(name)
  ) {
    return "verify";
  }
  if (/(edit|write|patch|create_file|str_replace)/.test(name)) return "edit";
  if (/(read|list|grep|glob|search|fetch|explore)/.test(name)) return "explore";
  if (/(command|shell|bash|pwsh|terminal|execute|run)/.test(name)) {
    return "command";
  }
  return "other";
}

export function toolLabel(tool: ToolTimelineItem): string {
  const name = normalizedName(tool.tool);
  if (/(read)/.test(name)) return "Read";
  if (/(grep|search)/.test(name)) return "Search";
  if (/(list|glob)/.test(name)) return "List";
  if (/(fetch)/.test(name)) return "Fetch";
  if (/(write)/.test(name)) return "Write";
  if (/(create_file)/.test(name)) return "Create";
  if (/(edit|patch|str_replace)/.test(name)) return "Edit";
  if (/(command|shell|bash|pwsh|terminal|execute|run)/.test(name)) {
    return "Run";
  }
  return tool.tool;
}

export function toolAction(tool: ToolTimelineItem): {
  verb: string;
  target: string;
} {
  const category = classifyTool(tool);
  const target = toolTarget(tool);
  const label = toolLabel(tool);
  if (label === "Read") return { verb: "Reading", target };
  if (label === "Search") return { verb: "Searching", target };
  if (label === "List") return { verb: "Listing", target };
  if (label === "Fetch") return { verb: "Fetching", target };
  if (label === "Write") return { verb: "Writing", target };
  if (label === "Create") return { verb: "Creating", target };
  if (category === "verify") return { verb: "Running", target };
  if (category === "edit") return { verb: "Editing", target };
  if (category === "command") return { verb: "Running", target };
  return { verb: "Running", target };
}
