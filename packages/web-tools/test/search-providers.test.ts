import { describe, expect, it } from "vitest";

import { BochaProvider } from "../src/search/bocha.js";
import { TavilyProvider } from "../src/search/tavily.js";

describe("TavilyProvider", () => {
  const provider = new TavilyProvider("test-key");

  it("builds an authorized request with basic depth", () => {
    const { headers, body } = provider.buildRequest({
      query: "electron vite",
      maxResults: 5,
      timelimit: "",
      allowedDomains: [],
      blockedDomains: [],
      topic: "",
    });
    expect(headers["authorization"]).toBe("Bearer test-key");
    expect(body).toMatchObject({
      query: "electron vite",
      max_results: 5,
      search_depth: "basic",
      include_answer: "basic",
    });
    expect(body["time_range"]).toBeUndefined();
    expect(body["topic"]).toBeUndefined();
  });

  it("maps the shared timelimit codes and only supported topics", () => {
    expect(
      provider.buildRequest({
        query: "q",
        maxResults: 1,
        timelimit: "w",
        allowedDomains: [],
        blockedDomains: [],
        topic: "news",
      }).body,
    ).toMatchObject({ time_range: "week", topic: "news" });

    // 不支持的 topic 静默忽略
    expect(
      provider.buildRequest({
        query: "q",
        maxResults: 1,
        timelimit: "y",
        allowedDomains: [],
        blockedDomains: [],
        topic: "",
      }).body["topic"],
    ).toBeUndefined();
  });

  it("passes domain filters through", () => {
    const { body } = provider.buildRequest({
      query: "q",
      maxResults: 3,
      timelimit: "",
      allowedDomains: ["docs.python.org"],
      blockedDomains: [],
      topic: "",
    });
    expect(body["include_domains"]).toEqual(["docs.python.org"]);
  });

  it("parses results into title/href/body", () => {
    expect(
      provider.parseResponse({
        results: [
          { title: "T", url: "https://a.com", content: "C" },
          { title: "no url", content: "ignored shaped" },
        ],
      }),
    ).toEqual([
      { title: "T", href: "https://a.com", body: "C" },
      { title: "no url", href: "", body: "ignored shaped" },
    ]);
  });

  it("returns an empty list for unexpected payloads", () => {
    expect(provider.parseResponse({})).toEqual([]);
    expect(provider.parseResponse(null)).toEqual([]);
    expect(provider.parseResponse({ results: "nope" })).toEqual([]);
  });
});

describe("BochaProvider", () => {
  const provider = new BochaProvider("bocha-key");

  it("requests summaries and maps freshness", () => {
    const { headers, body } = provider.buildRequest({
      query: "深度求索",
      maxResults: 4,
      timelimit: "m",
    });
    expect(headers["authorization"]).toBe("Bearer bocha-key");
    expect(body).toMatchObject({
      query: "深度求索",
      count: 4,
      summary: true,
      freshness: "oneMonth",
    });
  });

  it("parses nested webPages and prefers summary over snippet", () => {
    expect(
      provider.parseResponse({
        data: {
          webPages: {
            value: [
              { name: "N", url: "https://b.com", summary: "long", snippet: "short" },
              { name: "M", url: "https://c.com", snippet: "only-snippet" },
            ],
          },
        },
      }),
    ).toEqual([
      { title: "N", href: "https://b.com", body: "long" },
      { title: "M", href: "https://c.com", body: "only-snippet" },
    ]);
  });

  it("returns an empty list when the shape is missing", () => {
    expect(provider.parseResponse({})).toEqual([]);
    expect(provider.parseResponse({ data: {} })).toEqual([]);
    expect(provider.parseResponse({ data: { webPages: {} } })).toEqual([]);
    expect(provider.parseResponse({ data: { webPages: { value: "x" } } })).toEqual(
      [],
    );
  });
});
