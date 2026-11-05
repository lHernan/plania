import type { PackingRole } from "@/lib/types";

/** Private bucket of user-uploaded trip covers; objects live under `<tripId>/` (see trip_covers_migration.sql). */
export const TRIP_COVERS_BUCKET = "trip-covers";
export const TRIP_COVER_MAX_BYTES = 5 * 1024 * 1024;
/** Image types the bucket accepts, with the extension each object is stored with. */
export const TRIP_COVER_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const TRIP_COVER_ACCEPT = Object.keys(TRIP_COVER_TYPES).join(",");
/** Signed URLs last an hour; a cached one is reused until five minutes before it expires. */
export const TRIP_COVER_URL_SECONDS = 3600;
const URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type TripCoverError = "draft" | "offline" | "forbidden" | "type" | "size" | "upload" | "unavailable";

/** Why a file cannot be a cover, before anything is sent; null when it can. */
export function validateTripCoverFile(file: Pick<File, "type" | "size">): "type" | "size" | null {
  if (!TRIP_COVER_TYPES[file.type]) return "type";
  if (file.size > TRIP_COVER_MAX_BYTES) return "size";
  return null;
}

/** `<tripId>/<id>.<ext>`: the storage policies grant access by that first folder. */
export function tripCoverObjectPath(tripId: string, type: string, id: string = crypto.randomUUID()): string {
  return `${tripId}/${id}.${TRIP_COVER_TYPES[type] ?? "jpg"}`;
}

/**
 * The owner and shared editors change the cover; viewers only see it. The role of a shared
 * trip is the one the packing load resolved (trip_shares.role); unknown means viewer.
 */
export function canEditTripCover(
  trip: { userId?: string | null; packing?: { role: PackingRole } } | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!trip || !userId) return false;
  if (trip.userId === userId) return true;
  return trip.packing?.role === "editor";
}

type SignedUrlClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (path: string, expiresIn: number) => PromiseLike<{ data: { signedUrl: string } | null; error: unknown }>;
    };
  };
};

const urlCache = new Map<string, { url: string; expiresAt: number }>();
const pending = new Map<string, Promise<string | null>>();

/** A still-valid signed URL for the path, if one was already resolved. */
export function getCachedTripCoverUrl(path: string): string | null {
  const cached = urlCache.get(path);
  return cached && cached.expiresAt - URL_REFRESH_MARGIN_MS > Date.now() ? cached.url : null;
}

/** Drops a cached URL, e.g. when the image failed to load. */
export function forgetTripCoverUrl(path: string) {
  urlCache.delete(path);
}

export function clearTripCoverUrlCache() {
  urlCache.clear();
  pending.clear();
}

/**
 * A signed URL for a cover in the private bucket, cached in memory by path. Offline or on any
 * error it resolves to null (the placeholder shows) and the failure is not cached.
 */
export function resolveTripCoverUrl(path: string, client: SignedUrlClient): Promise<string | null> {
  const cached = getCachedTripCoverUrl(path);
  if (cached) return Promise.resolve(cached);
  if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve(null);
  const inFlight = pending.get(path);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const { data, error } = await client.storage.from(TRIP_COVERS_BUCKET).createSignedUrl(path, TRIP_COVER_URL_SECONDS);
      if (error || !data?.signedUrl) return null;
      urlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + TRIP_COVER_URL_SECONDS * 1000 });
      return data.signedUrl;
    } catch {
      return null;
    } finally {
      pending.delete(path);
    }
  })();
  pending.set(path, request);
  return request;
}
