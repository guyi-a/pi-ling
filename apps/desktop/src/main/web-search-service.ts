import { SearchService } from "@pi-ling/web-tools";

/**
 * 从环境变量构建搜索服务。
 *
 * key 来源与 llm-config 一致：`.env`（开发 = 仓库根，安装版 = userData）。
 * 两把 key 都空时返回 undefined —— 调用方此时不应注册 `web_search`，
 * 让 Agent 根本感知不到这个能力。
 */
export function createWebSearchService(
  env: NodeJS.ProcessEnv = process.env,
): SearchService | undefined {
  const service = new SearchService({
    tavilyApiKey: env["TAVILY_API_KEY"],
    bochaApiKey: env["BOCHA_API_KEY"],
  });
  return service.isEnabled ? service : undefined;
}
