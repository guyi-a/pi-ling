import type { ToolTimelineItem } from "../timeline/reducer";

export type ToolCategory =
  | "explore"
  | "edit"
  | "command"
  | "verify"
  | "meta"
  | "network"
  | "agent"
  | "other";

const PATH_KEYS = [
  "path",
  "file",
  "file_path",
  "filePath",
  "target_file",
  "target_path",
  "target_directory",
  "filename",
  "directory",
  "dir",
  "cwd",
  "working_directory",
  "workspace_path",
] as const;

const COMMAND_KEYS = [
  "command",
  "cmd",
  "script",
  "shell_command",
  "powershell_command",
] as const;

const SEARCH_KEYS = [
  "pattern",
  "query",
  "glob_pattern",
  "glob",
  "regex",
  "include",
  "search_term",
  "search",
  "search_query",
] as const;

const NAME_KEYS = [
  "name",
  "title",
  "skill",
  "skill_name",
  "agent_name",
  "agent_id",
  "goal_id",
  "job_id",
  "task",
  "prompt",
  "description",
  "message",
] as const;

function normalizedName(name: string): string {
  return name.toLowerCase().replaceAll(/[\s-]+/g, "_");
}

function stringArg(
  arguments_: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = arguments_[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function arrayArgSummary(
  arguments_: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = arguments_[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    const first = value[0];
    if (typeof first === "string") {
      return `${value.length} item${value.length === 1 ? "" : "s"}`;
    }
    if (typeof first === "object" && first !== null) {
      const record = first as Record<string, unknown>;
      const label =
        stringArg(record, ["content", "text", "title", "name", "id"]) ??
        JSON.stringify(record).slice(0, 40);
      return value.length === 1
        ? truncate(String(label))
        : `${value.length} items · ${truncate(String(label))}`;
    }
  }
  return undefined;
}

function truncate(text: string, max = 96): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function toolNameLabel(name: string): string {
  const normalized = normalizedName(name);

  if (/(read_image|image_read)/.test(normalized)) return "Read image";
  if (/(^read$|read_file)/.test(normalized)) return "Read";
  if (/web_search/.test(normalized)) return "Web search";
  if (/(^grep$|(^|_)grep($|_)|^search$)/.test(normalized)) return "Search";
  if (/(^glob$|glob_file)/.test(normalized)) return "Glob";
  if (/list_files/.test(normalized)) return "List";
  if (/web_fetch/.test(normalized)) return "Fetch";
  if (/(^fetch$|fetch_url)/.test(normalized)) return "Fetch";
  if (/(write_file|^write$|create_file)/.test(normalized)) return "Write";
  if (/(str_replace_editor|str_replace|edit_file|^edit$|patch)/.test(normalized)) {
    return "Edit";
  }
  if (/(^delete$|delete_file|remove|unlink)/.test(normalized)) return "Delete";
  if (/(rename|move|mv|cp)/.test(normalized)) return "Move";
  if (/(mkdir|make_dir|create_dir)/.test(normalized)) return "Create dir";
  if (/(todo_write|update_todo|todowrite)/.test(normalized)) return "Todo";
  if (/(exit_plan_mode|^plan$|update_plan|create_plan)/.test(normalized)) {
    return "Plan";
  }
  if (/(create_goal|update_goal|get_goal|goal)/.test(normalized)) return "Goal";
  if (/^skill/.test(normalized)) return "Skill";
  if (/job_(list|output|kill)|^job$/.test(normalized)) return "Job";
  if (/(subagent_fork|^subagent$|spawn_subagent)/.test(normalized)) {
    return "Subagent";
  }
  if (/workflow/.test(normalized)) return "Workflow";
  if (/ralph/.test(normalized)) return "Loop";
  if (/(list_agents|send_message|interrupt_agent)/.test(normalized)) {
    return "Agent";
  }
  if (/(command|shell|bash|pwsh|powershell|terminal|execute|run_code|run_command)/.test(normalized)) {
    return "Run";
  }
  return name;
}

export function toolTarget(tool: ToolTimelineItem): string {
  const args = tool.arguments;
  const path = stringArg(args, PATH_KEYS);
  const command = stringArg(args, COMMAND_KEYS);
  const search = stringArg(args, SEARCH_KEYS);
  const name = stringArg(args, NAME_KEYS);

  if (path && command) return truncate(`${path} · ${command}`);
  if (command) return truncate(command);
  if (search) return truncate(search);
  if (path) return truncate(path);
  if (name) return truncate(name);

  const todoSummary = arrayArgSummary(args, ["todos", "items", "tasks"]);
  if (todoSummary) return todoSummary;

  const oldText = stringArg(args, ["old_string", "oldText", "old_text"]);
  const newText = stringArg(args, ["new_string", "newText", "new_text"]);
  if (oldText && newText) {
    return truncate(`replace · ${oldText} → ${newText}`);
  }
  if (oldText) return truncate(`replace · ${oldText}`);

  const content = stringArg(args, ["content", "text", "body", "plan"]);
  if (content) return truncate(content);

  const url = stringArg(args, ["url", "uri", "href"]);
  if (url) return truncate(url);

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
  if (/(todo_write|update_todo|exit_plan_mode|^plan$|update_plan|create_plan|create_goal|update_goal|get_goal|^skill|job_|^ralph$)/.test(name)) {
    return "meta";
  }
  if (/web_search|web_fetch/.test(name)) return "network";
  if (/(subagent|workflow|list_agents|send_message|interrupt_agent)/.test(name)) {
    return "agent";
  }
  if (/(^delete$|delete_file|remove|unlink|rm)/.test(name)) return "edit";
  if (/(edit|write|patch|create_file|str_replace)/.test(name)) return "edit";
  if (/(read|list|glob|grep|fetch|explore|image)/.test(name)) {
    return "explore";
  }
  if (/(command|shell|bash|pwsh|terminal|execute|run)/.test(name)) {
    return "command";
  }
  return "other";
}

export function toolLabel(tool: ToolTimelineItem): string {
  return toolNameLabel(tool.tool);
}

export function toolAction(tool: ToolTimelineItem): {
  verb: string;
  target: string;
} {
  const category = classifyTool(tool);
  const target = toolTarget(tool);
  const label = toolLabel(tool);

  if (label === "Read" || label === "Read image") {
    return { verb: "Reading", target };
  }
  if (label === "Search") return { verb: "Searching", target };
  if (label === "Web search") return { verb: "Searching web", target };
  if (label === "Glob") return { verb: "Globbing", target };
  if (label === "List") return { verb: "Listing", target };
  if (label === "Fetch") return { verb: "Fetching", target };
  if (label === "Write") return { verb: "Writing", target };
  if (label === "Create dir") return { verb: "Creating", target };
  if (label === "Delete") return { verb: "Deleting", target };
  if (label === "Move") return { verb: "Moving", target };
  if (label === "Todo") return { verb: "Updating todos", target };
  if (label === "Plan") return { verb: "Presenting plan", target };
  if (label === "Goal") return { verb: "Updating goal", target };
  if (label === "Skill") return { verb: "Loading skill", target };
  if (label === "Job") return { verb: "Managing job", target };
  if (label === "Subagent") return { verb: "Delegating", target };
  if (label === "Workflow") return { verb: "Orchestrating", target };
  if (label === "Loop") return { verb: "Running loop", target };
  if (label === "Agent") return { verb: "Coordinating agents", target };
  if (category === "verify") return { verb: "Running", target };
  if (category === "edit") return { verb: "Editing", target };
  if (category === "command") return { verb: "Running", target };
  if (category === "network") return { verb: "Fetching", target };
  if (category === "agent") return { verb: "Delegating", target };
  if (category === "meta") return { verb: "Updating", target };
  return { verb: "Running", target };
}
