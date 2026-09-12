import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@pi-ling/agent-core";
import {
  CACHE_DEFAULT_TTL_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_USER_AGENT,
  FetchError,
  MAX_MAX_BYTES,
  MAX_TIMEOUT_MS,
  ResponseCache,
  fetchUrl,
} from "@pi-ling/web-tools";

/** 全进程共享的抓取缓存（与参考实现一致：跨会话复用同一份）。 */
let sharedCache: ResponseCache | undefined;

export function sharedWebFetchCache(): ResponseCache {
  sharedCache ??= new ResponseCache();
  return sharedCache;
}

/** 测试用：重置共享缓存。 */
export function resetSharedWebFetchCache(): void {
  sharedCache?.clear();
  sharedCache = undefined;
}

export interface WebFetchToolOptions {
  cache?: ResponseCache;
  userAgent?: string;
  /** 测试用：替换 fetch 实现。 */
  fetchImpl?: typeof fetch;
}

function formatResult(result: {
  title?: string;
  text?: string;
  contentType?: string;
  byteCount: number;
  statusCode: number;
  statusText: string;
  finalUrl: string;
  isRedirect?: boolean;
  redirectUrl?: string;
  cached?: boolean;
}): string {
  const lines: string[] = [];

  if (result.isRedirect && result.redirectUrl) {
    lines.push(
      "REDIRECT DETECTED: target host differs from the original.",
      "",
      `Final URL before redirect: ${result.finalUrl}`,
      `Redirects to: ${result.redirectUrl}`,
      "",
      "Cross-host redirects are not followed automatically. To read the redirected page, call web_fetch again with that URL.",
    );
    return lines.join("\n");
  }

  if (result.statusCode >= 400) {
    lines.push(`[HTTP ${result.statusCode} ${result.statusText}]`, "");
  }
  if (result.title) {
    lines.push(`Title: ${result.title}`, "");
  }
  if (result.text) {
    lines.push(result.text);
  } else if (result.contentType) {
    lines.push(
      `[Binary content: ${result.contentType}, ${result.byteCount} bytes — no text extracted]`,
    );
  } else {
    lines.push("[]");
  }
  return lines.join("\n");
}

export function createWebFetchTool(
  options: WebFetchToolOptions = {},
): AgentTool {
  const cache = options.cache ?? sharedWebFetchCache();
  const userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;

  return {
    name: "web_fetch",
    label: "Fetch",
    description:
      "Fetch a web page and return its cleaned plain text (not raw HTML). " +
      "Use after web_search to read a hit's full content, or when the user pastes a URL. " +
      "This WILL FAIL for authenticated or private URLs (Google Docs, Confluence, Jira, private GitHub, internal hosts) — tell the user instead of retrying. " +
      "Extraction drops <script>/<style>/<head> and all tags; HTML entities are decoded; paragraph and list structure is preserved; code blocks keep their line breaks. " +
      "Prefer the optional `prompt` to note what you are looking for. " +
      `Results are cached for ${Math.round(CACHE_DEFAULT_TTL_MS / 60000)} minutes — set use_cache=false to force a fresh fetch.`,
    parameters: Type.Object({
      url: Type.String({
        minLength: 1,
        description: "Target URL (http/https only).",
      }),
      prompt: Type.Optional(
        Type.String({
          description:
            "What you are looking for in the page. Prefixes the returned text as a reminder.",
        }),
      ),
      max_bytes: Type.Optional(
        Type.Number({
          description: `Max bytes to download. Default ${DEFAULT_MAX_BYTES}, max ${MAX_MAX_BYTES}.`,
        }),
      ),
      timeout_sec: Type.Optional(
        Type.Number({
          description: `Request timeout in seconds. Default 30, max ${MAX_TIMEOUT_MS / 1000}.`,
        }),
      ),
      use_cache: Type.Optional(
        Type.Boolean({
          description: "Use the response cache. Default true.",
        }),
      ),
    }),
    execute: async (_callId, arguments_, signal) => {
      const {
        url,
        prompt,
        max_bytes: maxBytes,
        timeout_sec: timeoutSec,
        use_cache: useCache = true,
      } = arguments_ as {
        url: string;
        prompt?: string;
        max_bytes?: number;
        timeout_sec?: number;
        use_cache?: boolean;
      };

      const effectiveMax =
        maxBytes && maxBytes > 0 ? Math.min(maxBytes, MAX_MAX_BYTES) : DEFAULT_MAX_BYTES;

      if (useCache) {
        const cached = cache.get(url, effectiveMax);
        if (cached) {
          return {
            content: [
              {
                type: "text",
                text: formatResult({ ...cached, cached: true }),
              },
            ],
          };
        }
      }

      try {
        const result = await fetchUrl(url, {
          maxBytes: effectiveMax,
          ...(timeoutSec && timeoutSec > 0
            ? { timeoutMs: Math.min(timeoutSec * 1000, MAX_TIMEOUT_MS) }
            : {}),
          userAgent,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });

        // 中断（用户取消）不应写缓存
        if (signal.aborted) {
          throw new Error("web_fetch was cancelled");
        }
        if (useCache && result.statusCode >= 200 && result.statusCode < 300) {
          cache.set(url, effectiveMax, result);
        }

        const text = formatResult(result);
        return {
          content: [
            {
              type: "text",
              text: prompt ? `[Extraction focus: ${prompt}]\n\n${text}` : text,
            },
          ],
        };
      } catch (error) {
        if (error instanceof FetchError) {
          throw new Error(`web_fetch: ${error.message}`);
        }
        throw error;
      }
    },
  };
}
