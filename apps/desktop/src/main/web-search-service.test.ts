import { describe, expect, it } from "vitest";

import { createWebSearchService } from "./web-search-service.js";

describe("createWebSearchService", () => {
  it("returns undefined when no search key is configured", () => {
    expect(createWebSearchService({})).toBeUndefined();
    expect(createWebSearchService({ TAVILY_API_KEY: "  " })).toBeUndefined();
    expect(createWebSearchService({ BOCHA_API_KEY: "" })).toBeUndefined();
  });

  it("enables the service when either key is present", () => {
    expect(createWebSearchService({ TAVILY_API_KEY: "t" })?.isEnabled).toBe(true);
    expect(createWebSearchService({ BOCHA_API_KEY: "b" })?.isEnabled).toBe(true);
  });

  it("reports both providers when both keys are present", () => {
    const service = createWebSearchService({
      TAVILY_API_KEY: "t",
      BOCHA_API_KEY: "b",
    });
    expect(service?.configuredProviders).toEqual(["bocha", "tavily"]);
  });
});
