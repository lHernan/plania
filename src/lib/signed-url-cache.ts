/** Signed URLs are reused until five minutes before they expire. */
const URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type SignedUrlClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (path: string, expiresIn: number) => PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
};

export type SignedUrlCache = {
  /** A still-valid signed URL for the path, if one was already resolved. */
  getCached: (path: string) => string | null;
  /** Drops a cached URL, e.g. when the image failed to load. */
  forget: (path: string) => void;
  clear: () => void;
  /** A signed URL for the path; offline or on any error null, and the failure is not cached. */
  resolve: (path: string, client: SignedUrlClient) => Promise<string | null>;
};

/** An in-memory cache of signed URLs for one private bucket, with concurrent requests shared. */
export function createSignedUrlCache(bucket: string, expiresInSeconds: number): SignedUrlCache {
  const urls = new Map<string, { url: string; expiresAt: number }>();
  const pending = new Map<string, Promise<string | null>>();

  const getCached = (path: string) => {
    const cached = urls.get(path);
    return cached && cached.expiresAt - URL_REFRESH_MARGIN_MS > Date.now() ? cached.url : null;
  };

  const resolve = (path: string, client: SignedUrlClient): Promise<string | null> => {
    const cached = getCached(path);
    if (cached) return Promise.resolve(cached);
    if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve(null);
    const inFlight = pending.get(path);
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
        if (error || !data?.signedUrl) return null;
        urls.set(path, { url: data.signedUrl, expiresAt: Date.now() + expiresInSeconds * 1000 });
        return data.signedUrl;
      } catch {
        return null;
      } finally {
        pending.delete(path);
      }
    })();
    pending.set(path, request);
    return request;
  };

  return {
    getCached,
    forget: (path) => {
      urls.delete(path);
    },
    clear: () => {
      urls.clear();
      pending.clear();
    },
    resolve,
  };
}
