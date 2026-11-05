import { compressImage } from "@/lib/image-compress";
import { TRIP_MEMORIES_BUCKET, memoryPhotoObjectPath, validateMemoryPhotoFile } from "@/lib/memory-photos";
import type { Memory, MemoryAudience, MemoryPhoto, TripMember } from "@/lib/types";

/**
 * Supabase persistence of trip memories (tables from src/lib/trip_memories_migration.sql).
 * RLS returns only the memories the caller may see; their photos live in the private
 * trip-memories bucket. Memories are online-only: nothing is queued while offline.
 */

export const MEMORIES_TABLE = "memories";
export const MEMORY_PHOTOS_TABLE = "memory_photos";
export const MEMORY_AUDIENCE_TABLE = "memory_audience";
export const MEMORY_NOTE_MAX = 4000;

/** Why a memory action did not happen. */
export type MemoryError = "draft" | "offline" | "forbidden" | "invalid" | "unavailable" | "failed";

export type MemoryDb = {
  id: string;
  trip_id: string;
  activity_id: string | null;
  author_id: string;
  note: string | null;
  rating: number | null;
  audience: MemoryAudience;
  created_at: string;
  updated_at: string;
};

export type MemoryPhotoDb = {
  id: string;
  memory_id: string;
  trip_id: string;
  path: string;
  caption: string | null;
  sort_order: number;
  created_at?: string;
};

/** What a memory change may set; undefined leaves a field as it is. */
export type MemoryPatch = {
  activityId?: string | null;
  note?: string | null;
  rating?: number | null;
};

export type NewMemory = MemoryPatch & {
  audience: MemoryAudience;
  /** Only for "selected": the members who see it besides the author. */
  audienceUserIds?: string[];
  photos?: File[];
};

type AudienceDb = { memory_id: string; user_id: string };
type DbError = { code?: string; message?: string } | null;
type QueryResult<T> = PromiseLike<{ data: T | null; error: DbError }>;

/** The migration was not applied yet: there are no memories to load or save. */
export function isMissingMemoriesTable(error: DbError): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /memor(y|ies)/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

export function mapMemoryPhotoFromDb(row: MemoryPhotoDb): MemoryPhoto {
  return {
    id: row.id,
    memoryId: row.memory_id,
    tripId: row.trip_id,
    path: row.path,
    caption: row.caption ?? null,
    sortOrder: row.sort_order ?? 0,
    ...(row.created_at ? { createdAt: row.created_at } : {}),
  };
}

export function mapMemoryFromDb(row: MemoryDb, photos: MemoryPhotoDb[], audience: AudienceDb[]): Memory {
  return {
    id: row.id,
    tripId: row.trip_id,
    activityId: row.activity_id ?? null,
    authorId: row.author_id,
    note: row.note ?? null,
    rating: row.rating ?? null,
    audience: row.audience === "selected" ? "selected" : "trip",
    audienceUserIds: audience.filter((entry) => entry.memory_id === row.id).map((entry) => entry.user_id),
    photos: photos
      .filter((photo) => photo.memory_id === row.id)
      .map(mapMemoryPhotoFromDb)
      .sort((left, right) => left.sortOrder - right.sortOrder),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Loading ─────────────────────────────────────────────────────────────────

type LoadClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { order: (column: string, options: { ascending: boolean }) => QueryResult<unknown[]> };
      in: (column: string, values: string[]) => QueryResult<unknown[]>;
    };
  };
};

/**
 * The memories of the trip the caller may see, with their photos and audience. It never
 * throws: without the tables the list is empty and not remote; on any other failure the
 * cached copy stays.
 */
export async function loadTripMemories(input: { client: LoadClient; tripId: string; cached?: Memory[] }): Promise<{ memories: Memory[]; remote: boolean }> {
  const { client, tripId } = input;
  const cached = input.cached ?? [];
  try {
    const { data, error } = await client.from(MEMORIES_TABLE).select("*").eq("trip_id", tripId).order("created_at", { ascending: true });
    if (error) {
      if (isMissingMemoriesTable(error)) return { memories: [], remote: false };
      console.error("Memories load failed:", error);
      return { memories: cached, remote: true };
    }
    const rows = (data ?? []) as MemoryDb[];
    if (rows.length === 0) return { memories: [], remote: true };

    const ids = rows.map((row) => row.id);
    const [photos, audience] = await Promise.all([
      client.from(MEMORY_PHOTOS_TABLE).select("*").eq("trip_id", tripId).order("sort_order", { ascending: true }),
      client.from(MEMORY_AUDIENCE_TABLE).select("memory_id,user_id").in("memory_id", ids),
    ]);
    if (photos.error || audience.error) {
      console.error("Memory photos or audience load failed:", photos.error ?? audience.error);
      return { memories: cached, remote: true };
    }
    return {
      memories: rows.map((row) => mapMemoryFromDb(row, (photos.data ?? []) as MemoryPhotoDb[], (audience.data ?? []) as AudienceDb[])),
      remote: true,
    };
  } catch (error) {
    console.error("Memories load failed:", error);
    return { memories: cached, remote: true };
  }
}

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbError }> };

/** The people of the trip (trip_members answers only its members), owner first. */
export async function fetchTripMembers(client: RpcClient, tripId: string): Promise<{ members: TripMember[]; error?: "unavailable" | "failed" }> {
  try {
    const { data, error } = await client.rpc("trip_members", { p_trip_id: tripId });
    if (error) {
      const missing = ["PGRST202", "42883"].includes(String(error.code ?? "")) || /trip_members/.test(error.message ?? "");
      return { members: [], error: missing ? "unavailable" : "failed" };
    }
    const rows = (Array.isArray(data) ? data : []) as { user_id: string; email: string | null; is_owner: boolean }[];
    const members = rows.map((row) => ({ userId: row.user_id, email: row.email ?? null, isOwner: Boolean(row.is_owner) }));
    return { members: [...members.filter((m) => m.isOwner), ...members.filter((m) => !m.isOwner)] };
  } catch {
    return { members: [], error: "failed" };
  }
}

// ─── Writes ──────────────────────────────────────────────────────────────────

type WriteResult = PromiseLike<{ error: DbError }>;
type Filterable = WriteResult & {
  eq: (column: string, value: string) => Filterable;
  in: (column: string, values: string[]) => Filterable;
};

export type MemoryWriteClient = {
  from: (table: string) => {
    insert: (rows: unknown) => WriteResult;
    update: (row: unknown) => Filterable;
    delete: () => Filterable;
  };
  storage: {
    from: (bucket: string) => {
      upload: (path: string, file: File, options: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
      remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
    };
  };
};

/** Best effort: an object left behind only costs storage. */
export async function removeMemoryObjects(client: MemoryWriteClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await client.storage.from(TRIP_MEMORIES_BUCKET).remove(paths);
  } catch (error) {
    console.error("Plania: memory photo cleanup error", error);
  }
}

/**
 * Compresses and uploads each file to `<trip>/<memory>/<uuid>.<ext>`, then saves its photo
 * row. A failed photo never stops the others; `failed` holds the indexes of those that did
 * not make it (their uploaded object is removed when the row could not be saved).
 */
export async function uploadMemoryPhotos(
  client: MemoryWriteClient,
  input: { tripId: string; memoryId: string; files: File[]; firstSortOrder: number },
): Promise<{ photos: MemoryPhoto[]; failed: number[] }> {
  const photos: MemoryPhoto[] = [];
  const failed: number[] = [];
  for (const [index, original] of input.files.entries()) {
    const file = await compressImage(original);
    if (validateMemoryPhotoFile(file)) {
      failed.push(index);
      continue;
    }
    const path = memoryPhotoObjectPath(input.tripId, input.memoryId, file.type);
    try {
      const { error: uploadError } = await client.storage
        .from(TRIP_MEMORIES_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false, cacheControl: "3600" });
      if (uploadError) {
        failed.push(index);
        continue;
      }
    } catch {
      failed.push(index);
      continue;
    }
    const row: MemoryPhotoDb = {
      id: crypto.randomUUID(),
      memory_id: input.memoryId,
      trip_id: input.tripId,
      path,
      caption: null,
      sort_order: input.firstSortOrder + photos.length,
    };
    let rowError: unknown = null;
    try {
      rowError = (await client.from(MEMORY_PHOTOS_TABLE).insert([row])).error;
    } catch (error) {
      rowError = error;
    }
    if (rowError) {
      await removeMemoryObjects(client, [path]);
      failed.push(index);
      continue;
    }
    photos.push(mapMemoryPhotoFromDb(row));
  }
  return { photos, failed };
}

// ─── Device-only hint: the last audience chosen per trip ────────────────────

const audienceKey = (tripId: string) => `plania_memory_audience_${tripId}`;

export function loadMemoryAudienceChoice(tripId: string): MemoryAudience {
  try {
    return window.localStorage.getItem(audienceKey(tripId)) === "selected" ? "selected" : "trip";
  } catch {
    return "trip";
  }
}

export function saveMemoryAudienceChoice(tripId: string, audience: MemoryAudience): void {
  try {
    window.localStorage.setItem(audienceKey(tripId), audience);
  } catch {
    // The choice is only a convenience.
  }
}
