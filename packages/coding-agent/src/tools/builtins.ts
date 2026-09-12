import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@pi-ling/agent-core";

import type { Workspace } from "../workspace/workspace.js";
import { CommandRunner } from "./command-runner.js";
import { createPlanTools } from "./meta-tools.js";
import { maybeSpillToolOutput } from "./spill-output.js";
import { createWebFetchTool, type WebFetchToolOptions } from "./web-fetch.js";
import { createWebSearchTool } from "./web-search.js";
import type { SearchService } from "@pi-ling/web-tools";

export interface ChangeCapture {
  capture(path: string): Promise<void>;
}

async function spillText(
  options: {
    sessionId?: string;
    workspaceRoot: string;
  },
  callId: string,
  text: string,
): Promise<string> {
  if (!options.sessionId) return text;
  const spilled = await maybeSpillToolOutput({
    sessionId: options.sessionId,
    callId,
    workspaceRoot: options.workspaceRoot,
    text,
  });
  return spilled.text;
}

export function createBuiltinTools(options: {
  workspace: Workspace;
  changes: ChangeCapture;
  commands?: CommandRunner;
  sessionId?: string;
  /** 传 false 可关闭联网工具（子 Agent / 测试用）。 */
  webFetch?: WebFetchToolOptions | false;
  /** 未配置搜索 key 时不要传；传了才会注册 web_search。 */
  searchService?: SearchService;
}): AgentTool[] {
  const commands = options.commands ?? new CommandRunner(options.workspace.root);

  const readFile: AgentTool = {
    name: "read_file",
    label: "Read file",
    description: "Read a UTF-8 text file inside the current workspace.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
    }),
    execute: async (_callId, arguments_) => {
      const { path } = arguments_ as { path: string };
      const content = await options.workspace.readText(path);
      return { content: [{ type: "text", text: content }] };
    },
  };

  const listFiles: AgentTool = {
    name: "list_files",
    label: "List files",
    description:
      "List files and directories inside the workspace. Recursive output is bounded.",
    parameters: Type.Object({
      path: Type.Optional(Type.String()),
      recursive: Type.Optional(Type.Boolean()),
    }),
    execute: async (_callId, arguments_) => {
      const { path = ".", recursive = false } = arguments_ as {
        path?: string;
        recursive?: boolean;
      };
      const entries = await options.workspace.list(path, recursive);
      return {
        content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
      };
    },
  };

  const grep: AgentTool = {
    name: "grep",
    label: "Search text",
    description:
      "Search text files with a regular expression. Results and traversal are bounded.",
    parameters: Type.Object({
      pattern: Type.String({ minLength: 1 }),
      path: Type.Optional(Type.String()),
    }),
    execute: async (_callId, arguments_) => {
      const { pattern, path = "." } = arguments_ as {
        pattern: string;
        path?: string;
      };
      const matches = await options.workspace.grep(pattern, path);
      const text = await spillText(
        {
          workspaceRoot: options.workspace.root,
          ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        },
        _callId,
        JSON.stringify(matches, null, 2),
      );
      return {
        content: [{ type: "text", text }],
      };
    },
  };

  const writeFile: AgentTool = {
    name: "write_file",
    label: "Write file",
    description:
      "Create or replace a UTF-8 text file inside the current workspace.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
      content: Type.String(),
    }),
    execute: async (_callId, arguments_) => {
      const { path, content } = arguments_ as {
        path: string;
        content: string;
      };
      await options.changes.capture(path);
      await options.workspace.writeText(path, content);
      return { content: [{ type: "text", text: `Wrote ${path}` }] };
    },
  };

  const editFile: AgentTool = {
    name: "edit_file",
    label: "Edit file",
    description:
      "Replace one exact text occurrence in a UTF-8 workspace file.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
      oldText: Type.String({ minLength: 1 }),
      newText: Type.String(),
    }),
    execute: async (_callId, arguments_) => {
      const { path, oldText, newText } = arguments_ as {
        path: string;
        oldText: string;
        newText: string;
      };
      const content = await options.workspace.readText(path);
      const occurrences = content.split(oldText).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `Expected exactly one occurrence in ${path}, found ${occurrences}`,
        );
      }
      await options.changes.capture(path);
      await options.workspace.writeText(path, content.replace(oldText, newText));
      return { content: [{ type: "text", text: `Edited ${path}` }] };
    },
  };

  const runCommand: AgentTool = {
    name: "run_command",
    label: "Run command",
    description:
      "Run a shell command with the workspace as cwd. Output and runtime are bounded.",
    parameters: Type.Object({
      command: Type.String({ minLength: 1 }),
    }),
    execute: async (_callId, arguments_, signal) => {
      const { command } = arguments_ as { command: string };
      const result = await commands.run(command, signal);
      const text = await spillText(
        {
          workspaceRoot: options.workspace.root,
          ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        },
        _callId,
        JSON.stringify(result, null, 2),
      );
      return {
        content: [
          {
            type: "text",
            text,
          },
        ],
      };
    },
  };

  const globTool: AgentTool = {
    name: "glob",
    label: "Glob files",
    description:
      "Find workspace files matching a glob pattern. Results are bounded.",
    parameters: Type.Object({
      glob_pattern: Type.String({ minLength: 1 }),
      target_directory: Type.Optional(Type.String()),
    }),
    execute: async (_callId, arguments_) => {
      const { glob_pattern, target_directory = "." } = arguments_ as {
        glob_pattern: string;
        target_directory?: string;
      };
      const matches = await options.workspace.glob(
        glob_pattern,
        target_directory,
      );
      const text = await spillText(
        {
          workspaceRoot: options.workspace.root,
          ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        },
        _callId,
        JSON.stringify(matches, null, 2),
      );
      return {
        content: [{ type: "text", text }],
      };
    },
  };

  const deleteTool: AgentTool = {
    name: "delete",
    label: "Delete file",
    description: "Delete a file inside the current workspace.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
    }),
    execute: async (_callId, arguments_) => {
      const { path: userPath } = arguments_ as { path: string };
      await options.changes.capture(userPath);
      await options.workspace.deleteFile(userPath);
      return { content: [{ type: "text", text: `Deleted ${userPath}` }] };
    },
  };

  const readImage: AgentTool = {
    name: "read_image",
    label: "Read image",
    description:
      "Read an image file from the workspace and attach it for vision models.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
    }),
    execute: async (_callId, arguments_) => {
      const { path: userPath } = arguments_ as { path: string };
      const image = await options.workspace.readImage(userPath);
      return {
        content: [
          {
            type: "text",
            text: `Read image ${userPath} (${image.size} bytes)`,
          },
          {
            type: "image",
            data: image.data,
            mimeType: image.mimeType,
          },
        ],
      };
    },
  };

  return [
    readFile,
    listFiles,
    grep,
    globTool,
    readImage,
    writeFile,
    editFile,
    deleteTool,
    runCommand,
    ...(options.webFetch === false
      ? []
      : [createWebFetchTool(options.webFetch ?? {})]),
    ...(options.webFetch === false || !options.searchService
      ? []
      : [createWebSearchTool({ service: options.searchService })]),
    ...createPlanTools(),
  ];
}
