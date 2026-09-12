import { extractTextFromHtml, extractTitleFromHtml } from "./html-text.js";
import { isPrivateHostname } from "./ssrf.js";

export const DEFAULT_MAX_BYTES = 2_000_000;
export const MAX_MAX_BYTES = 5_000_000;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_REDIRECTS = 10;
export const DEFAULT_USER_AGENT = "pi-ling/0.1 (WebFetch)";

const ACCEPT_HEADER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

export type FetchFailure =
  | "invalid-url"
  | "private-network"
  | "timeout"
  | "too-large"
  | "too-many-redirects"
  | "bad-redirect"
  | "request-failed";

export class FetchError extends Error {
  readonly failure: FetchFailure;

  constructor(failure: FetchFailure, message: string) {
    super(message);
    this.name = "FetchError";
    this.failure = failure;
  }
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  statusText: string;
  contentType?: string;
  byteCount: number;
  /** 清洗后的正文；二进制响应没有该字段。 */
  text?: string;
  title?: string;
  /** 跨域重定向：本函数不自动跟进，交由调用方决定。 */
  isRedirect?: boolean;
  redirectUrl?: string;
}

export interface FetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  allowPrivateNetwork?: boolean;
  userAgent?: string;
  /** 默认 true；false 时遇到 3xx 立即返回 isRedirect。 */
  followRedirects?: boolean;
  /** 测试用；默认全局 fetch。 */
  fetchImpl?: typeof fetch;
}

const STATUS_TEXTS: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  410: "Gone",
  418: "I'm a teapot",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function statusText(code: number): string {
  return STATUS_TEXTS[code] ?? "Unknown";
}

function normalizeUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new FetchError("invalid-url", "URL is empty");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new FetchError("invalid-url", `invalid URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FetchError(
      "invalid-url",
      "only http/https URLs are supported",
    );
  }
  if (!parsed.hostname) {
    throw new FetchError("invalid-url", "invalid URL: missing host");
  }
  return parsed;
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new FetchError(
        "too-large",
        `response too large (>${maxBytes} bytes)`,
      );
    }
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        throw new FetchError(
          "too-large",
          `response too large (>${maxBytes} bytes)`,
        );
      }
      chunks.push(value);
    }
  } finally {
    // 提前中止（超限/异常）时释放底层连接
    await reader.cancel().catch(() => {});
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  return /timeout|timed out|aborted/i.test(error.message);
}

/**
 * 抓取一个 http/https URL，返回清洗后的文本。
 *
 * 重定向策略（与参考实现一致）：
 * - 同 host 自动跟进，最多 `MAX_REDIRECTS` 跳
 * - **跨 host 不自动跟进**，返回 `isRedirect` + `redirectUrl`
 * - 每一跳的目标都做私网校验，命中直接抛 `private-network`
 */
export async function fetchUrl(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const parsed = normalizeUrl(rawUrl);
  const allowPrivate = options.allowPrivateNetwork ?? false;
  const followRedirects = options.followRedirects ?? true;
  const maxBytes = Math.min(
    options.maxBytes && options.maxBytes > 0
      ? options.maxBytes
      : DEFAULT_MAX_BYTES,
    MAX_MAX_BYTES,
  );
  const timeoutMs = Math.min(
    options.timeoutMs && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;
  const doFetch = options.fetchImpl ?? fetch;

  if (!allowPrivate && isPrivateHostname(parsed.hostname)) {
    throw new FetchError(
      "private-network",
      `blocked: private/localhost URL (${parsed.hostname})`,
    );
  }

  const originalHost = parsed.hostname.toLowerCase();
  let currentUrl = parsed.toString();
  let redirectCount = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": userAgent, accept: ACCEPT_HEADER },
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new FetchError(
          "timeout",
          `request timeout after ${timeoutMs}ms`,
        );
      }
      throw new FetchError(
        "request-failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timer);
    }

    const isRedirectStatus =
      response.status >= 300 && response.status < 400 && response.status !== 304;

    if (isRedirectStatus) {
      const location = response.headers.get("location") ?? "";
      await response.body?.cancel().catch(() => {});

      if (!followRedirects) {
        return {
          url: rawUrl.trim(),
          finalUrl: currentUrl,
          statusCode: response.status,
          statusText: statusText(response.status),
          byteCount: 0,
          isRedirect: true,
          ...(location ? { redirectUrl: resolveLocation(currentUrl, location) } : {}),
        };
      }
      if (!location) {
        throw new FetchError(
          "bad-redirect",
          "redirect response missing Location header",
        );
      }

      const nextUrl = resolveLocation(currentUrl, location);
      let nextHost: string;
      try {
        nextHost = new URL(nextUrl).hostname.toLowerCase();
      } catch {
        throw new FetchError(
          "bad-redirect",
          `invalid redirect target: ${nextUrl}`,
        );
      }

      if (!allowPrivate && isPrivateHostname(nextHost)) {
        throw new FetchError(
          "private-network",
          `blocked: redirect to private/localhost (${nextHost})`,
        );
      }

      // 跨 host：不跟进，交回调用方
      if (nextHost !== originalHost) {
        return {
          url: rawUrl.trim(),
          finalUrl: currentUrl,
          statusCode: response.status,
          statusText: statusText(response.status),
          byteCount: 0,
          isRedirect: true,
          redirectUrl: nextUrl,
        };
      }

      redirectCount += 1;
      if (redirectCount > MAX_REDIRECTS) {
        throw new FetchError(
          "too-many-redirects",
          `too many redirects (>${MAX_REDIRECTS})`,
        );
      }
      currentUrl = nextUrl;
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await readLimited(response, maxBytes);
    } catch (error) {
      if (error instanceof FetchError) throw error;
      if (isTimeoutError(error)) {
        throw new FetchError("timeout", `request timeout after ${timeoutMs}ms`);
      }
      throw new FetchError(
        "request-failed",
        error instanceof Error ? error.message : String(error),
      );
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    const lowered = (contentType ?? "").toLowerCase();
    const bodyText = new TextDecoder("utf-8").decode(bytes);

    const result: FetchResult = {
      url: rawUrl.trim(),
      finalUrl: currentUrl,
      statusCode: response.status,
      statusText: statusText(response.status),
      byteCount: bytes.length,
      ...(contentType ? { contentType } : {}),
    };

    if (lowered.includes("html") || lowered.includes("xml")) {
      const title = extractTitleFromHtml(bodyText);
      result.text = extractTextFromHtml(bodyText);
      if (title) result.title = title;
    } else if (lowered.includes("json") || lowered.includes("text")) {
      result.text = bodyText;
    }
    // 其他（二进制）：不填 text，由工具层提示

    return result;
  }
}

function resolveLocation(baseUrl: string, location: string): string {
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return location;
  }
}
