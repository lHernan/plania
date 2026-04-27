"use client";

export const DOCUMENTS_CACHE_NAME = "documents-cache-v1";
const DOCUMENTS_META_CACHE_NAME = "documents-cache-meta-v1";
const DOCUMENTS_META_KEY = "/__offline-documents__/meta";
const MAX_CACHED_DOCUMENTS = 40;

export type DocumentOfflineStatus = "available" | "pending" | "failed" | "unavailable";

type DocumentCacheMeta = Record<string, number>;

function canUseCacheStorage() {
  return typeof window !== "undefined" && "caches" in window;
}

function normalizeDocumentUrl(fileUrl: string) {
  if (typeof window === "undefined") return fileUrl;
  return new URL(fileUrl, window.location.href).toString();
}

export function isCacheableDocumentUrl(fileUrl: string) {
  if (!fileUrl) return false;

  try {
    const url = typeof window === "undefined"
      ? new URL(fileUrl, "https://plania.local")
      : new URL(fileUrl, window.location.href);
    const pathname = url.pathname.toLowerCase();

    return (
      pathname.includes("/storage/v1/object/public/activity-files/") ||
      /\.(pdf|png|jpe?g|gif|webp|bmp|svg)$/i.test(pathname)
    );
  } catch {
    return false;
  }
}

async function readDocumentCacheMeta() {
  if (!canUseCacheStorage()) return {} as DocumentCacheMeta;

  const metaCache = await caches.open(DOCUMENTS_META_CACHE_NAME);
  const response = await metaCache.match(DOCUMENTS_META_KEY);
  if (!response) return {} as DocumentCacheMeta;

  try {
    return (await response.json()) as DocumentCacheMeta;
  } catch {
    return {} as DocumentCacheMeta;
  }
}

async function writeDocumentCacheMeta(meta: DocumentCacheMeta) {
  if (!canUseCacheStorage()) return;

  const metaCache = await caches.open(DOCUMENTS_META_CACHE_NAME);
  await metaCache.put(
    DOCUMENTS_META_KEY,
    new Response(JSON.stringify(meta), {
      headers: { "Content-Type": "application/json" },
    })
  );
}

async function touchDocumentMeta(fileUrl: string) {
  const normalizedUrl = normalizeDocumentUrl(fileUrl);
  const meta = await readDocumentCacheMeta();
  meta[normalizedUrl] = Date.now();
  await writeDocumentCacheMeta(meta);
}

async function evictOldestDocuments(targetSize = MAX_CACHED_DOCUMENTS) {
  if (!canUseCacheStorage()) return;

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

export async function getCachedDocumentAvailability(fileUrl: string) {
  if (!canUseCacheStorage() || !isCacheableDocumentUrl(fileUrl)) return false;

  const normalizedUrl = normalizeDocumentUrl(fileUrl);
  const cache = await caches.open(DOCUMENTS_CACHE_NAME);
  const cachedResponse = await cache.match(normalizedUrl);
  if (!cachedResponse) return false;

  await touchDocumentMeta(normalizedUrl);
  return true;
}

export async function cacheDocumentForOffline(fileUrl: string) {
  if (!canUseCacheStorage() || !isCacheableDocumentUrl(fileUrl)) return false;

  const normalizedUrl = normalizeDocumentUrl(fileUrl);
  const cache = await caches.open(DOCUMENTS_CACHE_NAME);
  const existing = await cache.match(normalizedUrl);
  if (existing) {
    await touchDocumentMeta(normalizedUrl);
    return true;
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return false;
  }

  const response = await fetch(normalizedUrl, {
    credentials: "omit",
  });

  if (!response.ok && response.type !== "opaque") {
    throw new Error(`Document request failed with status ${response.status}`);
  }

  try {
    await cache.put(normalizedUrl, response.clone());
  } catch {
    await evictOldestDocuments(Math.max(0, MAX_CACHED_DOCUMENTS - 5));
    await cache.put(normalizedUrl, response.clone());
  }

  await touchDocumentMeta(normalizedUrl);
  await evictOldestDocuments(MAX_CACHED_DOCUMENTS);
  return true;
}

export async function removeCachedDocument(fileUrl: string) {
  if (!canUseCacheStorage() || !isCacheableDocumentUrl(fileUrl)) return;

  const normalizedUrl = normalizeDocumentUrl(fileUrl);
  const cache = await caches.open(DOCUMENTS_CACHE_NAME);
  await cache.delete(normalizedUrl);

  const meta = await readDocumentCacheMeta();
  delete meta[normalizedUrl];
  await writeDocumentCacheMeta(meta);
}

export async function getCachedDocumentBlobUrl(fileUrl: string) {
  if (!canUseCacheStorage() || !isCacheableDocumentUrl(fileUrl)) return null;

  const normalizedUrl = normalizeDocumentUrl(fileUrl);
  const cache = await caches.open(DOCUMENTS_CACHE_NAME);
  const cachedResponse = await cache.match(normalizedUrl);
  if (!cachedResponse) return null;

  await touchDocumentMeta(normalizedUrl);
  const blob = await cachedResponse.blob();
  return URL.createObjectURL(blob);
}

export async function openDocumentInNewTab(fileUrl: string) {
  const cachedBlobUrl = await getCachedDocumentBlobUrl(fileUrl);
  if (cachedBlobUrl) {
    const popup = window.open(cachedBlobUrl, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(cachedBlobUrl), 60_000);
    return Boolean(popup);
  }

  const popup = window.open(fileUrl, "_blank", "noopener,noreferrer");
  return Boolean(popup);
}
