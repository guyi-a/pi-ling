import { describe, expect, it } from "vitest";

import { mergeDedupe, SearchError, SearchService } from "../src/search/service.js";
import type { TextSearchResult } from "../src/search/types.js";

type Handler = (url: string, init: RequestInit | undefined) => Response;

/** 用路由表构造假 fetch；未声明的 URL 直接抛错，避免测试意外触网。 */
function fakeFetch(routes: Record<string, Handler>): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler(url, init);
  }) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TAVILY = "https://api.tavily.com/search";
const BOCHA = "https://api.bochaai.com/v1/web-search";

const tavilyPayload = {
  results: [{ title: "T1", url: "https://t1.com", content: "tavily body" }],
};
const bochaPayload = {
  code: 200,
  data: {
    webPages: {
      value: [{ name: "B1", url: "https://b1.com", summary: "bocha body" }],
    },
  },
};

describe("SearchService.enabled", () => {
  it("is disabled when no key is configured", () => {
    expect(new SearchService({}).isEnabled).toBe(false);
    expect(new SearchService({ tavilyApiKey: "" }).isEnabled).toBe(false);
  });

  it("is enabled with either key and reports configured providers", () => {
    expect(new SearchService({ tavilyApiKey: "k" }).isEnabled).toBe(true);
    expect(new SearchService({ bochaApiKey: "k" }).configuredProviders).toEqual([
      "bocha",
    ]);
    expect(
      new SearchService({ tavilyApiKey: "t", bochaApiKey: "b" })
        .configuredProviders,
    ).toEqual(["bocha", "tavily"]);
  });
});

describe("SearchService validation", () => {
  it("rejects an empty query", async () => {
    const service = new SearchService({ tavilyApiKey: "k" });
    await expect(service.search("   ")).rejects.toBeInstanceOf(SearchError);
  });

  it("rejects conflicting domain filters", async () => {
    const service = new SearchService({ tavilyApiKey: "k" });
    await expect(
      service.search("q", {
        allowedDomains: ["a.com"],
        blockedDomains: ["b.com"],
      }),
    ).rejects.toThrow(/不能同时指定/);
  });

  it("errors when the requested region has no key", async () => {
    const onlyTavily = new SearchService({ tavilyApiKey: "k" });
    await expect(onlyTavily.search("q", { region: "cn" })).rejects.toThrow(
      /BOCHA_API_KEY/,
    );

    const onlyBocha = new SearchService({ bochaApiKey: "k" });
    await expect(onlyBocha.search("q", { region: "global" })).rejects.toThrow(
      /TAVILY_API_KEY/,
    );
  });

  it("errors when nothing is configured", async () => {
    await expect(new SearchService({}).search("q")).rejects.toThrow(
      /至少填 TAVILY_API_KEY/,
    );
  });
});

describe("SearchService routing", () => {
  it("uses only Tavily for region=global", async () => {
    const calls: string[] = [];
    const service = new SearchService({ tavilyApiKey: "k" });
    const results = await service.search("q", {
      region: "global",
      fetchImpl: fakeFetch({
        [TAVILY]: () => {
          calls.push("tavily");
          return json(tavilyPayload);
        },
      }),
    });
    expect(calls).toEqual(["tavily"]);
    expect(results).toEqual([
      { title: "T1", href: "https://t1.com", body: "tavily body" },
    ]);
  });

  it("uses only Bocha for region=cn", async () => {
    const calls: string[] = [];
    const service = new SearchService({ bochaApiKey: "k" });
    const results = await service.search("q", {
      region: "cn",
      fetchImpl: fakeFetch({
        [BOCHA]: () => {
          calls.push("bocha");
          return json(bochaPayload);
        },
      }),
    });
    expect(calls).toEqual(["bocha"]);
    expect(results[0]).toMatchObject({ title: "B1" });
  });

  it("runs both providers and dedupes by href", async () => {
    const service = new SearchService({ tavilyApiKey: "t", bochaApiKey: "b" });
    const results = await service.search("q", {
      fetchImpl: fakeFetch({
        [BOCHA]: () =>
          json({
            code: 200,
            data: {
              webPages: {
                value: [
                  { name: "shared", url: "https://same.com", summary: "from bocha" },
                  { name: "B only", url: "https://b.com", summary: "b" },
                ],
              },
            },
          }),
        [TAVILY]: () =>
          json({
            results: [
              { title: "shared", url: "https://same.com", content: "from tavily" },
              { title: "T only", url: "https://t.com", content: "t" },
            ],
          }),
      }),
    });

    expect(results.map((r) => r.href)).toEqual([
      "https://same.com",
      "https://b.com",
      "https://t.com",
    ]);
    // 先到先得：Bocha 排前，去重后保留 Bocha 的 body
    expect(results[0]?.body).toBe("from bocha");
  });
});

describe("SearchService failure handling", () => {
  it("tolerates a single provider failing in both mode", async () => {
    const service = new SearchService({ tavilyApiKey: "t", bochaApiKey: "b" });
    const results = await service.search("q", {
      fetchImpl: fakeFetch({
        [BOCHA]: () => json({ message: "boom" }, 500),
        [TAVILY]: () => json(tavilyPayload),
      }),
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("T1");
  });

  it("fails when both providers fail", async () => {
    const service = new SearchService({ tavilyApiKey: "t", bochaApiKey: "b" });
    await expect(
      service.search("q", {
        fetchImpl: fakeFetch({
          [BOCHA]: () => json({}, 500),
          [TAVILY]: () => json({}, 500),
        }),
      }),
    ).rejects.toThrow(/两路全失败/);
  });

  it("maps auth, quota and rate-limit status codes", async () => {
    const service = new SearchService({ tavilyApiKey: "k" });
    for (const [status, pattern] of [
      [401, /鉴权失败/],
      [403, /配额不足/],
      [429, /限流/],
    ] as const) {
      await expect(
        service.search("q", {
          region: "global",
          fetchImpl: fakeFetch({ [TAVILY]: () => json({}, status) }),
        }),
      ).rejects.toThrow(pattern);
    }
  });

  it("surfaces Bocha business errors returned with HTTP 200", async () => {
    const service = new SearchService({ bochaApiKey: "k" });
    await expect(
      service.search("q", {
        region: "cn",
        fetchImpl: fakeFetch({
          [BOCHA]: () => json({ code: 403, msg: "quota exhausted" }),
        }),
      }),
    ).rejects.toThrow(/业务错误 code=403：quota exhausted/);
  });

  it("reports non-JSON responses", async () => {
    const service = new SearchService({ tavilyApiKey: "k" });
    await expect(
      service.search("q", {
        region: "global",
        fetchImpl: fakeFetch({
          [TAVILY]: () => new Response("<html>nope</html>", { status: 200 }),
        }),
      }),
    ).rejects.toThrow(/不是 JSON/);
  });
});

describe("mergeDedupe", () => {
  const make = (title: string, href: string): TextSearchResult => ({
    title,
    href,
    body: title,
  });

  it("keeps the first occurrence of each href", () => {
    expect(
      mergeDedupe([
        [make("a", "https://a.com"), make("b", "https://b.com")],
        [make("a2", "https://a.com")],
      ]).map((r) => r.title),
    ).toEqual(["a", "b"]);
  });

  it("falls back to title when href is missing and drops empty keys", () => {
    expect(
      mergeDedupe([[{ title: "no href", href: "", body: "" }, make("", "")]]),
    ).toEqual([{ title: "no href", href: "", body: "" }]);
  });
});
