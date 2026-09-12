import { describe, expect, it } from "vitest";

import { FetchError, fetchUrl } from "../src/fetch-url.js";

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** 用路由表构造假的 fetch，避免测试触网。 */
function fakeFetch(routes: Record<string, Handler>): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler(init);
  }) as unknown as typeof fetch;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

describe("fetchUrl validation", () => {
  it("rejects empty and non-http URLs", async () => {
    await expect(fetchUrl("")).rejects.toMatchObject({ failure: "invalid-url" });
    await expect(fetchUrl("file:///etc/passwd")).rejects.toMatchObject({
      failure: "invalid-url",
    });
    await expect(fetchUrl("ftp://example.com")).rejects.toMatchObject({
      failure: "invalid-url",
    });
  });

  it("blocks private and localhost targets before any request", async () => {
    let called = false;
    const fetchImpl = fakeFetch({});
    const spy = (async () => {
      called = true;
      return new Response("");
    }) as unknown as typeof fetch;

    for (const url of [
      "http://localhost/admin",
      "http://127.0.0.1:8080/",
      "http://169.254.169.254/latest/meta-data",
      "https://deep.internal/api",
    ]) {
      await expect(fetchUrl(url, { fetchImpl: spy })).rejects.toMatchObject({
        failure: "private-network",
      });
    }
    expect(called).toBe(false);
    expect(fetchImpl).toBeTypeOf("function");
  });
});

describe("fetchUrl happy path", () => {
  it("extracts text and title from HTML", async () => {
    const result = await fetchUrl("https://example.com/docs", {
      fetchImpl: fakeFetch({
        "https://example.com/docs": () =>
          html(
            "<html><head><title>Docs</title></head><body><p>Hello</p><p>World</p></body></html>",
          ),
      }),
    });

    expect(result.statusCode).toBe(200);
    expect(result.title).toBe("Docs");
    expect(result.text).toBe("Hello\n\nWorld");
    expect(result.byteCount).toBeGreaterThan(0);
    expect(result.finalUrl).toBe("https://example.com/docs");
  });

  it("returns raw body for JSON responses", async () => {
    const result = await fetchUrl("https://example.com/api", {
      fetchImpl: fakeFetch({
        "https://example.com/api": () =>
          new Response('{"ok":true}', {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
    });
    expect(result.text).toBe('{"ok":true}');
    expect(result.title).toBeUndefined();
  });

  it("omits text for binary responses", async () => {
    const result = await fetchUrl("https://example.com/logo.png", {
      fetchImpl: fakeFetch({
        "https://example.com/logo.png": () =>
          new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      }),
    });
    expect(result.text).toBeUndefined();
    expect(result.contentType).toBe("image/png");
  });

  it("keeps non-2xx responses as data, not errors", async () => {
    const result = await fetchUrl("https://example.com/missing", {
      fetchImpl: fakeFetch({
        "https://example.com/missing": () =>
          html("<p>Not found</p>", 404),
      }),
    });
    expect(result.statusCode).toBe(404);
    expect(result.statusText).toBe("Not Found");
  });
});

describe("fetchUrl redirects", () => {
  it("follows same-host redirects", async () => {
    const result = await fetchUrl("https://example.com/old", {
      fetchImpl: fakeFetch({
        "https://example.com/old": () => redirect("/new"),
        "https://example.com/new": () => html("<p>Moved</p>"),
      }),
    });
    expect(result.text).toBe("Moved");
    expect(result.finalUrl).toBe("https://example.com/new");
    expect(result.isRedirect).toBeUndefined();
  });

  it("stops at cross-host redirects and reports the target", async () => {
    const result = await fetchUrl("https://example.com/out", {
      fetchImpl: fakeFetch({
        "https://example.com/out": () => redirect("https://other.com/landing"),
      }),
    });
    expect(result.isRedirect).toBe(true);
    expect(result.redirectUrl).toBe("https://other.com/landing");
    expect(result.text).toBeUndefined();
  });

  it("does not follow redirects when followRedirects is false", async () => {
    const result = await fetchUrl("https://example.com/old", {
      followRedirects: false,
      fetchImpl: fakeFetch({
        "https://example.com/old": () => redirect("/new"),
      }),
    });
    expect(result.isRedirect).toBe(true);
    expect(result.redirectUrl).toBe("https://example.com/new");
  });

  it("blocks redirects that land on private hosts", async () => {
    await expect(
      fetchUrl("https://example.com/evil", {
        fetchImpl: fakeFetch({
          "https://example.com/evil": () => redirect("http://127.0.0.1/x"),
        }),
      }),
    ).rejects.toMatchObject({ failure: "private-network" });
  });

  it("errors after too many same-host hops", async () => {
    await expect(
      fetchUrl("https://example.com/loop", {
        fetchImpl: fakeFetch({
          "https://example.com/loop": () => redirect("/loop"),
        }),
      }),
    ).rejects.toMatchObject({ failure: "too-many-redirects" });
  });

  it("errors when a redirect has no Location header", async () => {
    await expect(
      fetchUrl("https://example.com/bad", {
        fetchImpl: fakeFetch({
          "https://example.com/bad": () => new Response(null, { status: 302 }),
        }),
      }),
    ).rejects.toMatchObject({ failure: "bad-redirect" });
  });
});

describe("fetchUrl limits and failures", () => {
  it("rejects responses over maxBytes", async () => {
    await expect(
      fetchUrl("https://example.com/big", {
        maxBytes: 16,
        fetchImpl: fakeFetch({
          "https://example.com/big": () =>
            new Response("x".repeat(1024), {
              status: 200,
              headers: { "content-type": "text/plain" },
            }),
        }),
      }),
    ).rejects.toMatchObject({ failure: "too-large" });
  });

  it("maps aborts to timeout", async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;

    await expect(
      fetchUrl("https://example.com/slow", { timeoutMs: 20, fetchImpl: hanging }),
    ).rejects.toMatchObject({ failure: "timeout" });
  });

  it("wraps network errors as request-failed", async () => {
    const failing = (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;

    await expect(
      fetchUrl("https://example.com/nope", { fetchImpl: failing }),
    ).rejects.toMatchObject({ failure: "request-failed" });
  });

  it("reports FetchError instances with a name and failure", async () => {
    const error = await fetchUrl("").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FetchError);
    expect((error as FetchError).name).toBe("FetchError");
  });
});
