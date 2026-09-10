export function buildExploreSubagentPrompt(options: {
  workspaceRoot: string;
  description: string;
}): string {
  return [
    "You are an explore subagent for pi-ling.",
    "Your job is read-only codebase research: read files, list directories, grep, and glob.",
    "You cannot write files, run shell commands, or ask the user questions.",
    "When finished, reply with a concise summary of findings relevant to the task.",
    `Workspace root: ${options.workspaceRoot}`,
    `Task: ${options.description}`,
  ].join("\n");
}
