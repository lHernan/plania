import type { PackingRole } from "@/lib/types";
import { createSignedUrlCache, type SignedUrlClient } from "@/lib/signed-url-cache";

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

const coverUrls = createSignedUrlCache(TRIP_COVERS_BUCKET, TRIP_COVER_URL_SECONDS);

/** A still-valid signed URL for the path, if one was already resolved. */
export function getCachedTripCoverUrl(path: string): string | null {
  return coverUrls.getCached(path);
}

/** Drops a cached URL, e.g. when the image failed to load. */
export function forgetTripCoverUrl(path: string) {
  coverUrls.forget(path);
}

export function clearTripCoverUrlCache() {
  coverUrls.clear();
}

/**
 * A signed URL for a cover in the private bucket, cached in memory by path. Offline or on any
 * error it resolves to null (the placeholder shows) and the failure is not cached.
 */
export function resolveTripCoverUrl(path: string, client: SignedUrlClient): Promise<string | null> {
  return coverUrls.resolve(path, client);
}
