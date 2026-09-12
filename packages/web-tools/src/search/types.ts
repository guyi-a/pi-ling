export type SearchRegion = "cn" | "global" | "both";

export type SearchTimelimit = "" | "d" | "w" | "m" | "y";

export type SearchTopic = "" | "finance" | "news";

/** 一条搜索结果。`body` 是摘要，不是正文（正文用 web_fetch）。 */
export interface TextSearchResult {
  title: string;
  href: string;
  body: string;
}

export interface SearchOptions {
  /** 默认 both：两路并发合并去重。 */
  region?: SearchRegion;
  /** 单 provider 上限，1-20，默认 10。 */
  maxResults?: number;
  /** 时间窗：d/w/m/y。 */
  timelimit?: SearchTimelimit;
  /** 与 blockedDomains 互斥；仅 Tavily 生效。 */
  allowedDomains?: readonly string[];
  blockedDomains?: readonly string[];
  /** 仅 Tavily 支持 finance/news。 */
  topic?: SearchTopic;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 测试用。 */
  fetchImpl?: typeof fetch;
}

export interface SearchProvider {
  readonly name: string;
  readonly endpoint: string;
  buildRequest(input: {
    query: string;
    maxResults: number;
    timelimit: SearchTimelimit;
    allowedDomains: readonly string[];
    blockedDomains: readonly string[];
    topic: SearchTopic;
  }): { headers: Record<string, string>; body: Record<string, unknown> };
  parseResponse(data: unknown): TextSearchResult[];
}

export const DEFAULT_MAX_RESULTS = 10;
export const MAX_MAX_RESULTS = 20;
export const DEFAULT_SEARCH_TIMEOUT_MS = 20_000;

export function clampMaxResults(value: number | undefined): number {
  if (!value || value <= 0) return DEFAULT_MAX_RESULTS;
  return Math.min(value, MAX_MAX_RESULTS);
}

export function truncateForError(input: string, limit = 300): string {
  return input.length <= limit ? input : `${input.slice(0, limit)}…`;
}

export function readString(
  source: Record<string, unknown>,
  key: string,
): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}
