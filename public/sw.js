const DOCUMENTS_CACHE_NAME = "documents-cache-v1";
const DOCUMENTS_META_CACHE_NAME = "documents-cache-meta-v1";
const DOCUMENTS_META_KEY = "/__offline-documents__/meta";
const MAX_CACHED_DOCUMENTS = 40;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "CACHE_DOCUMENT" && typeof data.url === "string") {
    event.waitUntil(cacheDocumentByUrl(data.url));
  }

  if (data.type === "DELETE_DOCUMENT" && typeof data.url === "string") {
    event.waitUntil(removeCachedDocument(data.url));
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (!shouldHandleDocumentRequest(event.request, requestUrl)) return;

  event.respondWith(handleDocumentRequest(event.request));
});

function shouldHandleDocumentRequest(request, url) {
  const pathname = url.pathname.toLowerCase();
  const isSupabaseActivityFile = pathname.includes("/storage/v1/object/public/activity-files/");
  const isDocumentExtension = /\.(pdf|png|jpe?g|gif|webp|bmp|svg)$/i.test(pathname);

  return isSupabaseActivityFile || isDocumentExtension || request.destination === "image";
}

async function handleDocumentRequest(request) {
  const cacheKey = normalizeDocumentUrl(request.url);
  const cache = await caches.open(DOCUMENTS_CACHE_NAME);
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    await touchDocumentMeta(cacheKey);
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok || networkResponse.type === "opaque") {
      await cache.put(cacheKey, networkResponse.clone());
      await touchDocumentMeta(cacheKey);
      await evictOldestDocuments(MAX_CACHED_DOCUMENTS);
    }

    return networkResponse;
  } catch {
    return new Response("This file is not available offline", {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Plania-Offline": "unavailable",
      },
    });
  }
}

async function cacheDocumentByUrl(fileUrl) {
  const cacheKey = normalizeDocumentUrl(fileUrl);
  const cache = await caches.open(DOCUMENTS_CACHE_NAME);
  const existing = await cache.match(cacheKey);
  if (existing) {
    await touchDocumentMeta(cacheKey);
    return;
  }

  const response = await fetch(cacheKey, { credentials: "omit" });
  if (!response.ok && response.type !== "opaque") {
    throw new Error(`Document request failed with status ${response.status}`);
  }

  await cache.put(cacheKey, response.clone());
  await touchDocumentMeta(cacheKey);
  await evictOldestDocuments(MAX_CACHED_DOCUMENTS);
}

async function removeCachedDocument(fileUrl) {
  const cacheKey = normalizeDocumentUrl(fileUrl);
  const cache = await caches.open(DOCUMENTS_CACHE_NAME);
  await cache.delete(cacheKey);

  const meta = await readDocumentCacheMeta();
  delete meta[cacheKey];
  await writeDocumentCacheMeta(meta);
}

function normalizeDocumentUrl(fileUrl) {
  return new URL(fileUrl, self.location.origin).toString();
}

async function readDocumentCacheMeta() {
  const metaCache = await caches.open(DOCUMENTS_META_CACHE_NAME);
  const response = await metaCache.match(DOCUMENTS_META_KEY);
  if (!response) return {};

  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function writeDocumentCacheMeta(meta) {
  const metaCache = await caches.open(DOCUMENTS_META_CACHE_NAME);
  await metaCache.put(
    DOCUMENTS_META_KEY,
    new Response(JSON.stringify(meta), {
      headers: { "Content-Type": "application/json" },
    })
  );
}

async function touchDocumentMeta(fileUrl) {
  const meta = await readDocumentCacheMeta();
  meta[fileUrl] = Date.now();
  await writeDocumentCacheMeta(meta);
}

async function evictOldestDocuments(targetSize) {
  const cache = await caches.open(DOCUMENTS_CACHE_NAME);
  const keys = await cache.keys();
  if (keys.length <= targetSize) return;

  const meta = await readDocumentCacheMeta();
  const sortedKeys = keys
    .map((request) => request.url)
    .sort((left, right) => (meta[left] ?? 0) - (meta[right] ?? 0));

  const deleteCount = Math.max(0, keys.length - targetSize);

  for (let index = 0; index < deleteCount; index += 1) {
    const url = sortedKeys[index];
    await cache.delete(url);
    delete meta[url];
  }

  await writeDocumentCacheMeta(meta);
}
