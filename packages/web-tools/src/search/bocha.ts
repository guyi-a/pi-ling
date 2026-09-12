import {
  readString,
  type SearchProvider,
  type SearchTimelimit,
  type TextSearchResult,
} from "./types.js";

/**
 * Bocha（博查）—— 国内源为主，中文覆盖好，直连 api.bochaai.com。
 * 免费试用 1000 次，注册 https://open.bochaai.com 取 key。
 */

const TIME_MAP: Readonly<Record<string, string>> = {
  d: "oneDay",
  w: "oneWeek",
  m: "oneMonth",
  y: "oneYear",
};

export class BochaProvider implements SearchProvider {
  readonly name = "bocha";
  readonly endpoint = "https://api.bochaai.com/v1/web-search";

  constructor(private readonly apiKey: string) {}

  buildRequest(input: {
    query: string;
    maxResults: number;
    timelimit: SearchTimelimit;
  }): { headers: Record<string, string>; body: Record<string, unknown> } {
    const body: Record<string, unknown> = {
      query: input.query,
      count: input.maxResults,
      summary: true, // 拿长摘要，不开只有短 snippet
    };
    const freshness = TIME_MAP[input.timelimit];
    if (freshness) body["freshness"] = freshness;

    // Bocha 无 topic / 域名黑白名单字段，调用方传了也静默忽略
    return {
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body,
    };
  }

  parseResponse(data: unknown): TextSearchResult[] {
    // 结构：data.webPages.value = [{ name, url, snippet, summary }]
    const root = (data ?? {}) as Record<string, unknown>;
    const dataObj = root["data"];
    if (!dataObj || typeof dataObj !== "object") return [];
    const webPages = (dataObj as Record<string, unknown>)["webPages"];
    if (!webPages || typeof webPages !== "object") return [];
    const pages = (webPages as Record<string, unknown>)["value"];
    if (!Array.isArray(pages)) return [];

    const output: TextSearchResult[] = [];
    for (const entry of pages) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      // summary=true 时优先长摘要，拿不到回落 snippet
      const body = readString(item, "summary") || readString(item, "snippet");
      output.push({
        title: readString(item, "name"),
        href: readString(item, "url"),
        body,
      });
    }
    return output;
  }
}
