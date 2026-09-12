import {
  readString,
  type SearchProvider,
  type SearchTimelimit,
  type SearchTopic,
  type TextSearchResult,
} from "./types.js";

/**
 * Tavily —— 海外源为主，直连 api.tavily.com。
 * 免费额度 1000 次/月，注册 https://app.tavily.com 取 key。
 */

const TIME_MAP: Readonly<Record<string, string>> = {
  d: "day",
  w: "week",
  m: "month",
  y: "year",
};

/** Tavily 只认这两个 topic；其他值静默忽略（上层不必关心 provider 差异）。 */
const SUPPORTED_TOPICS = new Set<string>(["finance", "news"]);

export class TavilyProvider implements SearchProvider {
  readonly name = "tavily";
  readonly endpoint = "https://api.tavily.com/search";

  constructor(private readonly apiKey: string) {}

  buildRequest(input: {
    query: string;
    maxResults: number;
    timelimit: SearchTimelimit;
    allowedDomains: readonly string[];
    blockedDomains: readonly string[];
    topic: SearchTopic;
  }): { headers: Record<string, string>; body: Record<string, unknown> } {
    const body: Record<string, unknown> = {
      query: input.query,
      max_results: input.maxResults,
      search_depth: "basic", // advanced 双倍 credits
      include_answer: "basic", // Tavily 自带一句总结，可作兜底
    };
    const timeRange = TIME_MAP[input.timelimit];
    if (timeRange) body["time_range"] = timeRange;
    if (SUPPORTED_TOPICS.has(input.topic)) body["topic"] = input.topic;
    if (input.allowedDomains.length > 0) {
      body["include_domains"] = [...input.allowedDomains];
    }
    if (input.blockedDomains.length > 0) {
      body["exclude_domains"] = [...input.blockedDomains];
    }

    return {
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body,
    };
  }

  parseResponse(data: unknown): TextSearchResult[] {
    const root = (data ?? {}) as Record<string, unknown>;
    const results = Array.isArray(root["results"]) ? root["results"] : [];
    const output: TextSearchResult[] = [];
    for (const entry of results) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      output.push({
        title: readString(item, "title"),
        href: readString(item, "url"),
        body: readString(item, "content"),
      });
    }
    return output;
  }
}
