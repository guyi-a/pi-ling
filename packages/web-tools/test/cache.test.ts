import { describe, expect, it, vi, afterEach } from "vitest";

import { ResponseCache } from "../src/cache.js";
import type { FetchResult } from "../src/fetch-url.js";

function result(text: string): FetchResult {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com",
    statusCode: 200,
    statusText: "OK",
    byteCount: text.length,
    text,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ResponseCache", () => {
  it("stores and retrieves by url and maxBytes", () => {
    const cache = new ResponseCache();
    const page = result("hello");
    cache.set("https://example.com", 1024, page);

    expect(cache.get("https://example.com", 1024)).toBe(page);
    // 不同 maxBytes 视为不同条目
    expect(cache.get("https://example.com", 2048)).toBeUndefined();
  });

  it("returns undefined for unknown keys", () => {
    const cache = new ResponseCache();
    expect(cache.get("https://nope.com", 1)).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    vi.useFakeTimers();
    const cache = new ResponseCache({ ttlMs: 1000 });
    cache.set("https://example.com", 1, result("x"));
    expect(cache.get("https://example.com", 1)).toBeDefined();

    vi.advanceTimersByTime(1001);
    expect(cache.get("https://example.com", 1)).toBeUndefined();
  });

  it("evicts the least recently used entry past maxEntries", () => {
    const cache = new ResponseCache({ maxEntries: 2 });
    cache.set("https://a.com", 1, result("a"));
    cache.set("https://b.com", 1, result("b"));
    // 访问 a 使其成为最近使用
    expect(cache.get("https://a.com", 1)).toBeDefined();

    cache.set("https://c.com", 1, result("c"));

    expect(cache.get("https://a.com", 1)).toBeDefined();
    expect(cache.get("https://b.com", 1)).toBeUndefined();
    expect(cache.get("https://c.com", 1)).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it("evicts when the byte budget is exceeded", () => {
    const cache = new ResponseCache({ maxBytes: 600 });
    cache.set("https://a.com", 1, result("a".repeat(300)));
    cache.set("https://b.com", 1, result("b".repeat(300)));
    // 再加一条会超预算，最老的 a 被淘汰
    cache.set("https://c.com", 1, result("c".repeat(100)));

    expect(cache.get("https://a.com", 1)).toBeUndefined();
    expect(cache.get("https://c.com", 1)).toBeDefined();
    expect(cache.totalBytes).toBeLessThanOrEqual(600);
  });

  it("replaces an existing entry without leaking its size", () => {
    const cache = new ResponseCache({ maxBytes: 1000 });
    cache.set("https://a.com", 1, result("a".repeat(400)));
    const before = cache.totalBytes;
    cache.set("https://a.com", 1, result("b".repeat(400)));

    expect(cache.size).toBe(1);
    expect(cache.totalBytes).toBe(before);
  });

  it("clears all entries", () => {
    const cache = new ResponseCache();
    cache.set("https://a.com", 1, result("a"));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.totalBytes).toBe(0);
  });
});
