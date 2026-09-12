import { BochaProvider } from "./bocha.js";
import { TavilyProvider } from "./tavily.js";
import {
  clampMaxResults,
  DEFAULT_SEARCH_TIMEOUT_MS,
  truncateForError,
  type SearchOptions,
  type SearchProvider,
  type SearchRegion,
  type TextSearchResult,
} from "./types.js";

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

export interface SearchConfig {
  tavilyApiKey?: string;
  bochaApiKey?: string;
}

/**
 * 聚合 Tavily（海外）与 Bocha（国内），按 region 路由。
 *
 * - 两把 key 都空 → `isEnabled` 为 false，调用方不应注册工具
 * - `both` 并发两路，单路失败容忍，双路都挂才报错
 * - 合并去重按 href（无 href 时退回 title），先到先得，Bocha 结果排前
 */
export class SearchService {
  readonly #tavily?: TavilyProvider;
  readonly #bocha?: BochaProvider;
  readonly #fetchImpl?: typeof fetch;

  constructor(config: SearchConfig, fetchImpl?: typeof fetch) {
    const tavilyKey = config.tavilyApiKey?.trim();
    const bochaKey = config.bochaApiKey?.trim();
    if (tavilyKey) this.#tavily = new TavilyProvider(tavilyKey);
    if (bochaKey) this.#bocha = new BochaProvider(bochaKey);
    if (fetchImpl) this.#fetchImpl = fetchImpl;
  }

  get isEnabled(): boolean {
    return Boolean(this.#tavily || this.#bocha);
  }

  /** 已配置的 provider 名，用于启动日志 / 诊断。 */
  get configuredProviders(): string[] {
    const names: string[] = [];
    if (this.#bocha) names.push(this.#bocha.name);
    if (this.#tavily) names.push(this.#tavily.name);
    return names;
  }

  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<TextSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) throw new SearchError("query 不能为空");

    const allowed = options.allowedDomains ?? [];
    const blocked = options.blockedDomains ?? [];
    if (allowed.length > 0 && blocked.length > 0) {
      throw new SearchError("allowed_domains 与 blocked_domains 不能同时指定");
    }

    const region: SearchRegion = options.region ?? "both";
    const maxResults = clampMaxResults(options.maxResults);
    const timeoutMs = options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;

    if (region === "global") {
      if (!this.#tavily) {
        throw new SearchError(
          "未配置 TAVILY_API_KEY —— region=global 需要 Tavily。去 https://app.tavily.com 注册免费 key。",
        );
      }
      return this.#runOne(this.#tavily, trimmed, options, maxResults, timeoutMs);
    }

    if (region === "cn") {
      if (!this.#bocha) {
        throw new SearchError(
          "未配置 BOCHA_API_KEY —— region=cn 需要 Bocha。去 https://open.bochaai.com 注册免费 key。",
        );
      }
      return this.#runOne(this.#bocha, trimmed, options, maxResults, timeoutMs);
    }

    if (region !== "both") {
      throw new SearchError(`region 必须是 cn/global/both 之一，收到 ${region}`);
    }

    const candidates: Array<SearchProvider | undefined> = [
      this.#bocha,
      this.#tavily,
    ];
    const providers = candidates.filter(
      (provider): provider is SearchProvider => provider !== undefined,
    );
    if (providers.length === 0) {
      throw new SearchError(
        "未配置任何搜索 key：至少填 TAVILY_API_KEY 或 BOCHA_API_KEY 之一。",
      );
    }
    if (providers.length === 1) {
      return this.#runOne(providers[0]!, trimmed, options, maxResults, timeoutMs);
    }

    const settled = await Promise.allSettled(
      providers.map((provider) =>
        this.#runOne(provider, trimmed, options, maxResults, timeoutMs),
      ),
    );

    const batches: TextSearchResult[][] = [];
    const failures: string[] = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") batches.push(outcome.value);
      else failures.push(errorMessage(outcome.reason));
    }

    if (batches.length === 0) {
      throw new SearchError(`region=both 两路全失败：${failures.join(" | ")}`);
    }
    return mergeDedupe(batches);
  }

  async #runOne(
    provider: SearchProvider,
    query: string,
    options: SearchOptions,
    maxResults: number,
    timeoutMs: number,
  ): Promise<TextSearchResult[]> {
    const { headers, body } = provider.buildRequest({
      query,
      maxResults,
      timelimit: options.timelimit ?? "",
      allowedDomains: options.allowedDomains ?? [],
      blockedDomains: options.blockedDomains ?? [],
      topic: options.topic ?? "",
    });

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    const doFetch = options.fetchImpl ?? this.#fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(provider.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (timeoutSignal.aborted) {
        throw new SearchError(`${provider.name} 超时（${timeoutMs}ms）`);
      }
      throw new SearchError(`${provider.name} 网络错误：${errorMessage(error)}`);
    }

    const raw = await response.text();

    if (response.status === 401) {
      throw new SearchError(`${provider.name} 鉴权失败（401）—— 检查 key 是否有效`);
    }
    if (response.status === 403) {
      throw new SearchError(`${provider.name} 配额不足（403）—— 免费额度可能已用完`);
    }
    if (response.status === 429) {
      throw new SearchError(`${provider.name} 限流（429）—— 稍后再试`);
    }
    if (!response.ok) {
      throw new SearchError(
        `${provider.name} HTTP ${response.status}：${truncateForError(raw)}`,
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new SearchError(
        `${provider.name} 返回的不是 JSON：${truncateForError(raw)}`,
      );
    }

    // Bocha 业务失败时仍返回 HTTP 200（如 quota 用完），body 里带 code
    const businessCode = readBusinessCode(data);
    if (businessCode !== undefined && !isBusinessOk(businessCode)) {
      throw new SearchError(
        `${provider.name} 业务错误 code=${String(businessCode)}：${readBusinessMessage(data)}`,
      );
    }

    return provider.parseResponse(data);
  }
}

/** 按 href 去重合并（无 href 退回 title），先到先得。 */
export function mergeDedupe(
  batches: ReadonlyArray<readonly TextSearchResult[]>,
): TextSearchResult[] {
  const seen = new Set<string>();
  const output: TextSearchResult[] = [];
  for (const batch of batches) {
    for (const result of batch) {
      const key = result.href || result.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(result);
    }
  }
  return output;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readBusinessCode(data: unknown): unknown {
  if (!data || typeof data !== "object") return undefined;
  return (data as Record<string, unknown>)["code"];
}

function isBusinessOk(code: unknown): boolean {
  return code === 200 || code === "200";
}

function readBusinessMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const message = record["msg"] ?? record["message"];
  return typeof message === "string" ? message : "";
}
