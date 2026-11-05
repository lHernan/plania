import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it } from "vitest";

const ORIGIN = "https://tachao.app";
const source = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");

/** A Cache Storage stand-in keyed by URL, enough for the worker's pages cache. */
function createCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const urlOf = (input: Request | string) => new URL(typeof input === "string" ? input : input.url, ORIGIN);
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      async match(input: Request | string, options?: { ignoreSearch?: boolean }) {
        const url = urlOf(input);
        for (const [key, response] of store) {
          const keyUrl = new URL(key);
          const same = options?.ignoreSearch ? keyUrl.pathname === url.pathname : keyUrl.href === url.href;
          if (same) return response.clone();
        }
        return undefined;
      },
      async put(input: Request | string, response: Response) {
        store.set(urlOf(input).href, response);
      },
      async keys() {
        return [...store.keys()].map((key) => new Request(key));
      },
      async delete(input: Request | string) {
        return store.delete(urlOf(input).href);
      },
    };
  };
  return { open, stores };
}

function loadWorker(online: boolean) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const caches = createCaches();
  const fetchCalls: string[] = [];
  const context = {
    self: {
      addEventListener: (type: string, handler: (event: unknown) => void) => (handlers[type] = handler),
      location: { origin: ORIGIN },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    caches,
    fetch: async (input: Request | string) => {
      fetchCalls.push(typeof input === "string" ? input : input.url);
      if (!online) throw new TypeError("offline");
      return new Response(`<html>${typeof input === "string" ? input : input.url}</html>`, { status: 200 });
    },
    URL, Request, Response, Headers, console,
  };
  vm.runInNewContext(source, context);

  const navigate = async (path: string) => {
    let responded: Promise<Response> | undefined;
    const request = new Request(`${ORIGIN}${path}`);
    Object.defineProperty(request, "mode", { value: "navigate" });
    handlers.fetch({ request, respondWith: (r: Promise<Response>) => (responded = r) });
    const response = await responded!;
    return response.text();
  };
  const message = async (data: unknown) => {
    let pending: Promise<unknown> | undefined;
    handlers.message({ data, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  const seed = async (path: string) => {
    const cache = await caches.open("pages-v1");
    await cache.put(`${ORIGIN}${path}`, new Response(`<html>cached ${path}</html>`));
  };
  return { navigate, message, seed, caches, fetchCalls };
}

describe("service worker, trip pages offline", () => {
  let worker: ReturnType<typeof loadWorker>;
  beforeEach(() => {
    worker = loadWorker(false);
  });

  it("serves the exact cached page first", async () => {
    await worker.seed("/");
    await worker.seed("/trips/a/map");
    await worker.seed("/trips/a");
    expect(await worker.navigate("/trips/a/map")).toBe("<html>cached /trips/a/map</html>");
  });

  it("serves a cached copy of the same page under another ?day=", async () => {
    await worker.seed("/trips/a?day=2026-11-15");
    expect(await worker.navigate("/trips/a?day=2026-11-16")).toBe("<html>cached /trips/a?day=2026-11-15</html>");
  });

  it("serves another cached page of the same trip before any other trip", async () => {
    await worker.seed("/trips/b");
    await worker.seed("/trips/a/wallet");
    expect(await worker.navigate("/trips/a/map")).toBe("<html>cached /trips/a/wallet</html>");
  });

  it("serves a cached page of another trip instead of the landing", async () => {
    await worker.seed("/");
    await worker.seed("/trips/b/overview");
    expect(await worker.navigate("/trips/a")).toBe("<html>cached /trips/b/overview</html>");
  });

  it("falls back to the landing when no trip page is cached", async () => {
    await worker.seed("/");
    expect(await worker.navigate("/trips/a")).toBe("<html>cached /</html>");
  });

  it("never serves a trip page for a page that is not a trip", async () => {
    await worker.seed("/");
    await worker.seed("/trips/b");
    expect(await worker.navigate("/share/token")).toBe("<html>cached /</html>");
  });
});

describe("service worker, caching pages on request", () => {
  it("caches a page the app asks for, without its query", async () => {
    const worker = loadWorker(true);
    await worker.message({ type: "CACHE_PAGE", url: `${ORIGIN}/trips/a/map?day=2026-11-15` });
    const offline = loadWorker(false);
    // Same cache contents in a fresh offline worker.
    const cache = await offline.caches.open("pages-v1");
    const source = await worker.caches.open("pages-v1");
    for (const request of await source.keys()) await cache.put(request, (await source.match(request))!);
    expect(await offline.navigate("/trips/a/map")).toContain("/trips/a/map");
  });

  it("ignores pages of other origins", async () => {
    const worker = loadWorker(true);
    await worker.message({ type: "CACHE_PAGE", url: "https://evil.example/trips/a" });
    expect(worker.fetchCalls).toEqual([]);
  });

  it("still caches a page loaded online", async () => {
    const worker = loadWorker(true);
    await worker.navigate("/trips/a");
    const cache = await worker.caches.open("pages-v1");
    expect(await cache.match(`${ORIGIN}/trips/a`)).toBeTruthy();
  });
});
