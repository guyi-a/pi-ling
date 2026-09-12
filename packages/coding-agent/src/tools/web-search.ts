import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@pi-ling/agent-core";
import {
  DEFAULT_MAX_RESULTS,
  MAX_MAX_RESULTS,
  SearchService,
  type SearchRegion,
} from "@pi-ling/web-tools";

const REGIONS: SearchRegion[] = ["cn", "global", "both"];
const TIMELIMITS = ["d", "w", "m", "y"];
const TOPICS = ["finance", "news"];

export interface WebSearchToolOptions {
  /** 无 key 时不要在 createBuiltinTools 里注册该工具。 */
  service: SearchService;
}

interface WebSearchHit {
  title: string;
  href: string;
  body: string;
}

function formatHits(hits: WebSearchHit[]): string {
  if (hits.length === 0) {
    return [
      "0 results.",
      "Try different keywords, drop the timelimit/topic/domain filters, or switch region.",
    ].join("\n");
  }
  return hits
    .map((hit, index) => {
      const title = hit.title || "(untitled)";
      const link = hit.href ? `\n   ${hit.href}` : "";
      const body = hit.body ? `\n   ${hit.body}` : "";
      return `${index + 1}. ${title}${link}${body}`;
    })
    .join("\n\n");
}

export function createWebSearchTool(options: WebSearchToolOptions): AgentTool {
  const { service } = options;

  return {
    name: "web_search",
    label: "Web search",
    description:
      "Search the web and return a ranked list of {title, href, body} hits. " +
      "Use for current events, unfamiliar libraries, product or service info, or anything your training data may not cover. " +
      "Prefer specific queries over broad ones. " +
      `region 'cn' uses the China-focused provider, 'global' the international one, 'both' (default) runs both and merges. Use a specific region when you know the topic; otherwise leave the default. ` +
      "After searching, call web_fetch on a hit's href when you need the full page rather than the snippet.",
    parameters: Type.Object({
      query: Type.String({
        minLength: 1,
        description:
          "Search query. Keep the language consistent with the user's (Chinese or English).",
      }),
      region: Type.Optional(
        Type.String({
          enum: REGIONS,
          description: "Which providers to query. Default both.",
        }),
      ),
      max_results: Type.Optional(
        Type.Number({
          description: `Max results per provider (1-${MAX_MAX_RESULTS}, default ${DEFAULT_MAX_RESULTS}).`,
        }),
      ),
      timelimit: Type.Optional(
        Type.String({
          enum: TIMELIMITS,
          description: "Restrict to recency: d / w / m / y.",
        }),
      ),
      topic: Type.Optional(
        Type.String({
          enum: TOPICS,
          description: "Only honoured by the international provider.",
        }),
      ),
      allowed_domains: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Only include these domains. Mutually exclusive with blocked_domains.",
        }),
      ),
      blocked_domains: Type.Optional(
        Type.Array(Type.String(), {
          description: "Exclude these domains. Mutually exclusive with allowed_domains.",
        }),
      ),
    }),
    execute: async (_callId, arguments_, signal) => {
      const {
        query,
        region,
        max_results: maxResults,
        timelimit,
        topic,
        allowed_domains: allowedDomains,
        blocked_domains: blockedDomains,
      } = arguments_ as {
        query: string;
        region?: SearchRegion;
        max_results?: number;
        timelimit?: "d" | "w" | "m" | "y";
        topic?: "finance" | "news";
        allowed_domains?: string[];
        blocked_domains?: string[];
      };

      const hits = await service.search(query, {
        signal,
        ...(region ? { region } : {}),
        ...(maxResults ? { maxResults } : {}),
        ...(timelimit ? { timelimit } : {}),
        ...(topic ? { topic } : {}),
        ...(allowedDomains ? { allowedDomains } : {}),
        ...(blockedDomains ? { blockedDomains } : {}),
      });

      return {
        content: [
          {
            type: "text",
            text: [
              `Query: ${query}`,
              `Results: ${hits.length}`,
              "",
              formatHits(hits),
              "",
              "When you use these results, cite each source as a markdown link — [Title](href) — so the user can verify it.",
            ].join("\n"),
          },
        ],
      };
    },
  };
}
