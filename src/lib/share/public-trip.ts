import type { getServiceRoleSupabase } from "@/lib/supabase-server";
import { isLinkExpired } from "@/lib/share/grant";
import { TRIP_MEMORIES_BUCKET } from "@/lib/memory-photos";
import { TRIP_COVERS_BUCKET } from "@/lib/trip-cover";
import type { PublicMemory } from "@/lib/types";

type AdminClient = ReturnType<typeof getServiceRoleSupabase>;

/** Signed URLs of the public page last an hour, like the in-app ones. */
export const PUBLIC_SHARE_URL_SECONDS = 3600;

/** Shown when the server cannot check share links: the anon key can no longer read them. */
export const SERVICE_ROLE_REQUIRED_ERROR =
  "SUPABASE_SERVICE_ROLE_KEY no es la service role key (es una publishable/anon key). Usa la service_role secret del dashboard de Supabase.";

export type ValidShareLink<Row> = { ok: true; link: Row } | { ok: false; status: 404 | 410; error: string };

/**
 * Whether a share link row can be used: it exists, is not revoked and has not expired.
 * Share links are read only here, on the server, with the service role (RLS grants no link reads).
 */
export function checkShareLink<Row extends { revoked_at: string | null; expires_at: string | null }>(link: Row | null | undefined): ValidShareLink<Row> {
  if (!link) return { ok: false, status: 404, error: "Enlace no válido" };
  if (link.revoked_at) return { ok: false, status: 410, error: "Este enlace fue revocado" };
  if (isLinkExpired(link)) return { ok: false, status: 410, error: "Este enlace expiró" };
  return { ok: true, link };
}

/** The columns of a day the public page shows. */
export const PUBLIC_DAY_COLUMNS = "id, date, city, label";
/** The columns of an activity the public page shows; notes, bookings and costs stay private. */
export const PUBLIC_ACTIVITY_COLUMNS = "id, day_id, title, time, duration_min, location, category, state";

export type PublicDay = { id: string; date: string; city: string | null; label: string | null };
export type PublicActivity = {
  id: string;
  day_id: string;
  title: string;
  time: string | null;
  duration_min?: number | null;
  location?: string | null;
  category?: string | null;
  state?: string | null;
};

const pick = <T extends string>(row: Record<string, unknown>, keys: readonly T[]) =>
  Object.fromEntries(keys.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])) as Record<T, unknown>;

/** Only the public fields of a day row, whatever the query returned. */
export function toPublicDay(row: Record<string, unknown>): PublicDay {
  return pick(row, ["id", "date", "city", "label"] as const) as PublicDay;
}

/** Only the public fields of an activity row, whatever the query returned. */
export function toPublicActivity(row: Record<string, unknown>): PublicActivity {
  return pick(row, ["id", "day_id", "title", "time", "duration_min", "location", "category", "state"] as const) as PublicActivity;
}

type MemoryRow = { id: string; trip_id: string; activity_id: string | null; note: string | null; rating: number | null; audience: string; created_at: string };
type PhotoRow = { id: string; memory_id: string; trip_id: string; path: string; caption: string | null; sort_order: number | null };

/**
 * The trip's memories shared with the whole trip ("trip" audience), with signed photo URLs.
 * Memories shared with some people, their photos and every author or audience detail stay out.
 * Any read failure (for example, the memories migration not applied yet) means no public story.
 */
export async function readPublicMemories(admin: AdminClient, tripId: string): Promise<PublicMemory[]> {
  const { data: memoryRows, error } = await admin
    .from("memories")
    .select("id, trip_id, activity_id, note, rating, audience, created_at")
    .eq("trip_id", tripId)
    .eq("audience", "trip")
    .order("created_at", { ascending: true });
  if (error || !memoryRows) return [];
  // Checked again here: the public page must never show a memory meant for some people only.
  const memories = (memoryRows as MemoryRow[]).filter((row) => row.trip_id === tripId && row.audience === "trip");
  if (memories.length === 0) return [];

  const memoryIds = memories.map((row) => row.id);
  const { data: photoRows } = await admin
    .from("memory_photos")
    .select("id, memory_id, trip_id, path, caption, sort_order")
    .eq("trip_id", tripId)
    .in("memory_id", memoryIds)
    .order("sort_order", { ascending: true });
  // A photo is public only if it lives in its own public memory's folder of this trip.
  const photos = ((photoRows ?? []) as PhotoRow[]).filter(
    (photo) => photo.trip_id === tripId && memoryIds.includes(photo.memory_id) && photo.path.startsWith(`${tripId}/${photo.memory_id}/`),
  );

  const urls = new Map<string, string>();
  if (photos.length > 0) {
    const { data: signed } = await admin.storage
      .from(TRIP_MEMORIES_BUCKET)
      .createSignedUrls(photos.map((photo) => photo.path), PUBLIC_SHARE_URL_SECONDS);
    for (const entry of signed ?? []) if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  }

  return memories.map((row) => ({
    id: row.id,
    activityId: row.activity_id,
    note: row.note,
    rating: row.rating,
    createdAt: row.created_at,
    photos: photos
      .filter((photo) => photo.memory_id === row.id && urls.has(photo.path))
      .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
      .map((photo) => ({ id: photo.id, url: urls.get(photo.path)!, caption: photo.caption })),
  }));
}

/** A signed URL of the trip's cover, or null without one (or when it cannot be read). */
export async function readPublicCoverUrl(admin: AdminClient, tripId: string): Promise<string | null> {
  const { data, error } = await admin.from("trips").select("cover_path").eq("id", tripId).maybeSingle();
  const coverPath = (data as { cover_path?: string | null } | null)?.cover_path;
  if (error || !coverPath || !coverPath.startsWith(`${tripId}/`)) return null;
  const { data: signed } = await admin.storage.from(TRIP_COVERS_BUCKET).createSignedUrl(coverPath, PUBLIC_SHARE_URL_SECONDS);
  return signed?.signedUrl ?? null;
}
