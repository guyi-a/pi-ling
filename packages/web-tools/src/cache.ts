import type { FetchResult } from "./fetch-url.js";

export const CACHE_DEFAULT_ENTRIES = 100;
export const CACHE_DEFAULT_BYTES = 50 * 1024 * 1024; // 50 MB
export const CACHE_DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 min

interface CacheEntry {
  result: FetchResult;
  storedAt: number;
  size: number;
}

/**
 * 抓取结果 LRU 缓存，key 为 `url|maxBytes`，带 TTL 与总字节上限。
 *
 * 只应缓存成功（2xx）的整页结果；调用方负责判断。
 * 用 Map 的插入顺序实现 LRU：命中后重新插入到队尾。
 */
export class ResponseCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #ttlMs: number;
  #totalBytes = 0;

  constructor(options: {
    maxEntries?: number;
    maxBytes?: number;
    ttlMs?: number;
  } = {}) {
    this.#maxEntries = options.maxEntries ?? CACHE_DEFAULT_ENTRIES;
    this.#maxBytes = options.maxBytes ?? CACHE_DEFAULT_BYTES;
    this.#ttlMs = options.ttlMs ?? CACHE_DEFAULT_TTL_MS;
  }

  get(url: string, maxBytes: number): FetchResult | undefined {
    const key = cacheKey(url, maxBytes);
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.storedAt > this.#ttlMs) {
      this.#delete(key, entry);
      return undefined;
    }
    // 命中：移到队尾表示最近使用
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.result;
  }

  set(url: string, maxBytes: number, result: FetchResult): void {
    const key = cacheKey(url, maxBytes);
    const existing = this.#entries.get(key);
    if (existing) this.#delete(key, existing);

    const size = entrySize(result);
    while (
      this.#entries.size > 0 &&
      (this.#entries.size >= this.#maxEntries ||
        this.#totalBytes + size > this.#maxBytes)
    ) {
      const oldestKey = this.#entries.keys().next();
      if (oldestKey.done) break;
      const oldest = this.#entries.get(oldestKey.value)!;
      this.#delete(oldestKey.value, oldest);
    }

    this.#entries.set(key, { result, storedAt: Date.now(), size });
    this.#totalBytes += size;
  }

  clear(): void {
    this.#entries.clear();
    this.#totalBytes = 0;
  }

  get size(): number {
    return this.#entries.size;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  #delete(key: string, entry: CacheEntry): void {
    this.#entries.delete(key);
    this.#totalBytes -= entry.size;
  }
}

function cacheKey(url: string, maxBytes: number): string {
  return `${url.trim()}|${maxBytes}`;
}

function entrySize(result: FetchResult): number {
  return (result.text?.length ?? 0) + 256;
}
