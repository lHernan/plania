import { createSignedUrlCache, type SignedUrlClient } from "@/lib/signed-url-cache";

/** Private bucket of memory photos; objects live under `<tripId>/<memoryId>/` (see trip_memories_migration.sql). */
export const TRIP_MEMORIES_BUCKET = "trip-memories";
export const MEMORY_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
/** Image types the bucket accepts, with the extension each object is stored with. */
export const MEMORY_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const MEMORY_PHOTO_ACCEPT = Object.keys(MEMORY_PHOTO_TYPES).join(",");
export const MEMORY_PHOTO_URL_SECONDS = 3600;

/** Why a (compressed) file cannot be uploaded; null when it can. */
export function validateMemoryPhotoFile(file: Pick<File, "type" | "size">): "type" | "size" | null {
  if (!MEMORY_PHOTO_TYPES[file.type]) return "type";
  if (file.size > MEMORY_PHOTO_MAX_BYTES) return "size";
  return null;
}

/** `<tripId>/<memoryId>/<id>.<ext>`: the storage policies check the trip and memory folders. */
export function memoryPhotoObjectPath(tripId: string, memoryId: string, type: string, id: string = crypto.randomUUID()): string {
  return `${tripId}/${memoryId}/${id}.${MEMORY_PHOTO_TYPES[type] ?? "jpg"}`;
}

const urls = createSignedUrlCache(TRIP_MEMORIES_BUCKET, MEMORY_PHOTO_URL_SECONDS);

export const getCachedMemoryPhotoUrl = (path: string) => urls.getCached(path);
export const forgetMemoryPhotoUrl = (path: string) => urls.forget(path);
export const clearMemoryPhotoUrlCache = () => urls.clear();
/** A signed URL of a memory photo; null offline, on error or when the caller may not see it. */
export const resolveMemoryPhotoUrl = (path: string, client: SignedUrlClient) => urls.resolve(path, client);
