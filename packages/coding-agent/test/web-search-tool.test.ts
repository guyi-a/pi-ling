import { describe, expect, it } from "vitest";

import { SearchService } from "@pi-ling/web-tools";

import { createBuiltinTools } from "../src/tools/builtins.js";
import { createWebSearchTool } from "../src/tools/web-search.js";

type Handler = () => Response;

function fakeFetch(routes: Record<string, Handler>): typeof fetch {
  return (async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler();
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TAVILY = "https://api.tavily.com/search";
const signal = new AbortController().signal;

function textOf(result: { content: Array<{ type: string }> }): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } =>
      block.type === "text" && "text" in block,
    )
    .map((block) => block.text)
    .join("\n");
}

describe("createWebSearchTool", () => {
  it("exposes a web_search tool with the expected parameters", () => {
    const tool = createWebSearchTool({
      service: new SearchService({ tavilyApiKey: "k" }),
    });
    expect(tool.name).toBe("web_search");
    expect(tool.label).toBe("Web search");
    const schema = tool.parameters as unknown as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["query", "region", "max_results", "timelimit"]),
    );
  });

  it("renders hits with position, title, href and body", async () => {
    const service = new SearchService(
      { tavilyApiKey: "k" },
      fakeFetch({
        [TAVILY]: () =>
          json({
            results: [
              { title: "Guide", url: "https://d.com/guide", content: "Body one" },
              { title: "FAQ", url: "https://d.com/faq", content: "Body two" },
            ],
          }),
      }),
    );
    const tool = createWebSearchTool({ service });

    const text = textOf(
      await tool.execute("c1", { query: "how to", region: "global" }, signal),
    );
    expect(text).toContain("Query: how to");
    expect(text).toContain("Results: 2");
    expect(text).toContain("1. Guide");
    expect(text).toContain("https://d.com/guide");
    expect(text).toContain("Body one");
    expect(text).toContain("2. FAQ");
    expect(text).toContain("[Title](href)");
  });

  it("explains an empty result set instead of looking broken", async () => {
    const service = new SearchService(
      { tavilyApiKey: "k" },
      fakeFetch({ [TAVILY]: () => json({ results: [] }) }),
    );
    const tool = createWebSearchTool({ service });

    const text = textOf(
      await tool.execute("c1", { query: "zzz", region: "global" }, signal),
    );
    expect(text).toContain("Results: 0");
    expect(text).toContain("Try different keywords");
  });

  it("surfaces provider errors to the agent", async () => {
    const service = new SearchService(
      { tavilyApiKey: "k" },
      fakeFetch({ [TAVILY]: () => json({}, 401) }),
    );
    const tool = createWebSearchTool({ service });

    await expect(
      tool.execute("c1", { query: "q", region: "global" }, signal),
    ).rejects.toThrow(/鉴权失败/);
  });
});

describe("createBuiltinTools web registration", () => {
  const workspace = {
    root: "/tmp",
    readText: async () => "",
    list: async () => [],
    grep: async () => [],
    glob: async () => [],
    readImage: async () => ({ data: "", mimeType: "image/png", size: 0 }),
    writeText: async () => {},
    editText: async () => {},
    deleteFile: async () => {},
  } as never;

  function names(options: Parameters<typeof createBuiltinTools>[0]): string[] {
    return createBuiltinTools(options).map((tool) => tool.name);
  }

  it("registers web_fetch but not web_search without a service", () => {
    const tools = names({ workspace, changes: { capture: async () => {} } });
    expect(tools).toContain("web_fetch");
    expect(tools).not.toContain("web_search");
  });

  it("registers web_search when a service is provided", () => {
    const tools = names({
      workspace,
      changes: { capture: async () => {} },
      searchService: new SearchService({ tavilyApiKey: "k" }),
    });
    expect(tools).toContain("web_search");
  });

  it("omits both web tools when webFetch is false", () => {
    const tools = names({
      workspace,
      changes: { capture: async () => {} },
      webFetch: false,
      searchService: new SearchService({ tavilyApiKey: "k" }),
    });
    expect(tools).not.toContain("web_fetch");
    expect(tools).not.toContain("web_search");
  });
});
