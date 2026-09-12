import { describe, expect, it } from "vitest";

import { ResponseCache } from "@pi-ling/web-tools";

import {
  createWebFetchTool,
  resetSharedWebFetchCache,
} from "../src/tools/web-fetch.js";

type Handler = () => Response | Promise<Response>;

function fakeFetch(routes: Record<string, Handler>): typeof fetch {
  return (async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler();
  }) as unknown as typeof fetch;
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const signal = new AbortController().signal;

function textOf(result: { content: Array<{ type: string }> }): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } =>
      block.type === "text" && "text" in block,
    )
    .map((block) => block.text)
    .join("\n");
}

describe("createWebFetchTool", () => {
  it("exposes a web_fetch tool with the expected parameters", () => {
    const tool = createWebFetchTool({ cache: new ResponseCache() });
    expect(tool.name).toBe("web_fetch");
    expect(tool.label).toBe("Fetch");
    const schema = tool.parameters as unknown as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["url", "prompt", "use_cache"]),
    );
  });

  it("returns extracted text prefixed by the extraction focus", async () => {
    const tool = createWebFetchTool({
      cache: new ResponseCache(),
      fetchImpl: fakeFetch({
        "https://docs.example.com/a": () =>
          html("<title>Guide</title><p>Step one</p>"),
      }),
    });

    const result = await tool.execute(
      "call-1",
      { url: "https://docs.example.com/a", prompt: "find steps" },
      signal,
    );
    const text = textOf(result);
    expect(text).toContain("[Extraction focus: find steps]");
    expect(text).toContain("Title: Guide");
    expect(text).toContain("Step one");
  });

  it("serves repeat fetches from the cache", async () => {
    let calls = 0;
    const tool = createWebFetchTool({
      cache: new ResponseCache(),
      fetchImpl: fakeFetch({
        "https://docs.example.com/cached": () => {
          calls += 1;
          return html("<p>once</p>");
        },
      }),
    });

    await tool.execute("c1", { url: "https://docs.example.com/cached" }, signal);
    await tool.execute("c2", { url: "https://docs.example.com/cached" }, signal);
    expect(calls).toBe(1);
  });

  it("bypasses the cache when use_cache is false", async () => {
    let calls = 0;
    const tool = createWebFetchTool({
      cache: new ResponseCache(),
      fetchImpl: fakeFetch({
        "https://docs.example.com/fresh": () => {
          calls += 1;
          return html("<p>fresh</p>");
        },
      }),
    });

    await tool.execute("c1", { url: "https://docs.example.com/fresh" }, signal);
    await tool.execute(
      "c2",
      { url: "https://docs.example.com/fresh", use_cache: false },
      signal,
    );
    expect(calls).toBe(2);
  });

  it("reports cross-host redirects instead of following them", async () => {
    const tool = createWebFetchTool({
      cache: new ResponseCache(),
      fetchImpl: fakeFetch({
        "https://docs.example.com/out": () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://elsewhere.com/x" },
          }),
      }),
    });

    const text = textOf(
      await tool.execute(
        "c1",
        { url: "https://docs.example.com/out" },
        signal,
      ),
    );
    expect(text).toContain("REDIRECT DETECTED");
    expect(text).toContain("https://elsewhere.com/x");
  });

  it("surfaces blocked private URLs as tool errors", async () => {
    const tool = createWebFetchTool({
      cache: new ResponseCache(),
      fetchImpl: fakeFetch({}),
    });
    await expect(
      tool.execute("c1", { url: "http://localhost:3000/admin" }, signal),
    ).rejects.toThrow(/private\/localhost/);
  });

  it("describes binary responses without text", async () => {
    const tool = createWebFetchTool({
      cache: new ResponseCache(),
      fetchImpl: fakeFetch({
        "https://docs.example.com/x.png": () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      }),
    });
    const text = textOf(
      await tool.execute("c1", { url: "https://docs.example.com/x.png" }, signal),
    );
    expect(text).toContain("[Binary content: image/png");
  });

  it("does not cache failed fetches", async () => {
    let calls = 0;
    const tool = createWebFetchTool({
      cache: new ResponseCache(),
      fetchImpl: fakeFetch({
        "https://docs.example.com/boom": () => {
          calls += 1;
          throw new Error("ENOTFOUND");
        },
      }),
    });

    await expect(
      tool.execute("c1", { url: "https://docs.example.com/boom" }, signal),
    ).rejects.toThrow(/web_fetch/);
    await expect(
      tool.execute("c2", { url: "https://docs.example.com/boom" }, signal),
    ).rejects.toThrow(/web_fetch/);
    expect(calls).toBe(2);
  });
});

describe("sharedWebFetchCache", () => {
  it("can be reset between runs", () => {
    resetSharedWebFetchCache();
    const first = createWebFetchTool();
    expect(first.name).toBe("web_fetch");
    resetSharedWebFetchCache();
  });
});
