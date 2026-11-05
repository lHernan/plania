import { authHeaders } from "@/lib/auth-headers";
import { loadPackingList, removePackingList } from "@/lib/packing-assistant";
import type {
  PackingList,
  PackingRecord,
  PackingRole,
  PackingScope,
  TripPacking,
  TripShareUser,
  WeatherSummary,
} from "@/lib/types";

/**
 * Supabase persistence of the packing lists (table from src/lib/packing_items_migration.sql).
 * Each trip has one shared list and one personal list per person; RLS returns only the
 * caller's personal rows. The weather strip and the generation date stay on the device that
 * generated the list (see savePackingMeta): they are hints, not shared data.
 */

export const PACKING_TABLE = "packing_items";

export type PackingItemDb = {
  id: string;
  trip_id: string;
  scope: PackingScope;
  owner_id: string | null;
  category: string;
  name: string;
  quantity: number;
  reason: string | null;
  status: PackingRecord["status"];
  assigned_to: string | null;
  sort_order: number;
  created_at?: string;
};

type DbError = { code?: string; message?: string } | null;

/** The migration was not applied yet: the list keeps working on this device only. */
export function isMissingPackingTable(error: DbError): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /packing_items/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

export function mapPackingRowFromDb(row: PackingItemDb): PackingRecord {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    reason: row.reason ?? "",
    status: row.status,
    scope: row.scope,
    category: row.category,
    ownerId: row.owner_id,
    assignedTo: row.assigned_to,
    sortOrder: row.sort_order,
    ...(row.created_at ? { createdAt: row.created_at } : {}),
  };
}

/** created_by and the timestamps are left to the database defaults. */
export function packingRecordToDb(record: PackingRecord, tripId: string): Omit<PackingItemDb, "created_at"> {
  return {
    id: record.id,
    trip_id: tripId,
    scope: record.scope,
    owner_id: record.scope === "personal" ? record.ownerId : null,
    category: record.category,
    name: record.name,
    quantity: record.quantity,
    reason: record.reason || null,
    status: record.status,
    assigned_to: record.scope === "shared" ? record.assignedTo : null,
    sort_order: record.sortOrder,
  };
}

export type PackingPatch = Partial<Pick<PackingRecord, "status" | "assignedTo" | "name" | "quantity">>;

export function packingPatchToDb(patch: PackingPatch): Partial<PackingItemDb> {
  const row: Partial<PackingItemDb> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.quantity !== undefined) row.quantity = patch.quantity;
  return row;
}

/** The records of one list: the shared one, or the given person's own list. */
export function recordsOf(items: PackingRecord[], scope: PackingScope, userId: string | null): PackingRecord[] {
  return items
    .filter((item) => item.scope === scope && (scope === "shared" || item.ownerId === userId))
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

/** Turns a generated or legacy list into rows of the given list, with real ids and order. */
export function packingListToRecords(list: PackingList, scope: PackingScope, ownerId: string | null): PackingRecord[] {
  let order = 0;
  return list.categories.flatMap((category) =>
    category.items.map((item) => ({
      id: crypto.randomUUID(),
      name: item.name,
      quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      reason: item.reason ?? "",
      status: item.status === "packed" ? "packed" : "pending",
      scope,
      category: category.name,
      ownerId: scope === "personal" ? ownerId : null,
      assignedTo: null,
      sortOrder: order++,
    })),
  );
}

/** The list the UI shows, grouped by category in the stored order; null when it is empty. */
export function buildPackingList(tripId: string, items: PackingRecord[], scope: PackingScope, userId: string | null): PackingList | null {
  const records = recordsOf(items, scope, userId);
  if (records.length === 0) return null;
  const categories: PackingList["categories"] = [];
  for (const record of records) {
    let category = categories.find((entry) => entry.name === record.category);
    if (!category) {
      category = { name: record.category, items: [] };
      categories.push(category);
    }
    category.items.push({
      id: record.id,
      name: record.name,
      quantity: record.quantity,
      reason: record.reason,
      status: record.status,
      assignedTo: record.assignedTo,
    });
  }
  const meta = loadPackingMeta(tripId, scope);
  const earliest = records.map((record) => record.createdAt ?? "").filter(Boolean).sort()[0];
  return {
    tripId,
    generatedAt: meta?.generatedAt ?? earliest ?? new Date().toISOString(),
    weatherSummaries: meta?.weatherSummaries ?? [],
    categories,
  };
}

// ─── Device-only hints: generation metadata and the chosen mode ──────────────

type PackingMeta = { generatedAt: string; weatherSummaries: WeatherSummary[] };

const metaKey = (tripId: string, scope: PackingScope) => `plania_packing_meta_${tripId}_${scope}`;
const modeKey = (tripId: string) => `plania_packing_mode_${tripId}`;

export function loadPackingMeta(tripId: string, scope: PackingScope): PackingMeta | null {
  try {
    const raw = window.localStorage.getItem(metaKey(tripId, scope));
    return raw ? (JSON.parse(raw) as PackingMeta) : null;
  } catch {
    return null;
  }
}

export function savePackingMeta(tripId: string, scope: PackingScope, meta: PackingMeta): void {
  try {
    window.localStorage.setItem(metaKey(tripId, scope), JSON.stringify(meta));
  } catch {
    // Without storage the weather strip is simply not shown.
  }
}

export function loadPackingMode(tripId: string): PackingScope {
  try {
    return window.localStorage.getItem(modeKey(tripId)) === "shared" ? "shared" : "personal";
  } catch {
    return "personal";
  }
}

export function savePackingMode(tripId: string, mode: PackingScope): void {
  try {
    window.localStorage.setItem(modeKey(tripId), mode);
  } catch {
    // The choice is only a convenience.
  }
}

// ─── Loading ─────────────────────────────────────────────────────────────────

type QueryResult<T> = PromiseLike<{ data: T | null; error: DbError }>;

type PackingClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (column: string, options: { ascending: boolean }) => QueryResult<unknown[]>;
        eq: (column: string, value: string) => QueryResult<{ role?: string }[]>;
      };
    };
    upsert: (rows: unknown[]) => PromiseLike<{ error: DbError }>;
  };
};

/** The owner and editors write the shared list; anyone else the trip is shared with only reads it. */
async function resolveRole(client: PackingClient, tripId: string, userId: string | null, tripOwnerId?: string | null): Promise<PackingRole> {
  if (!userId) return "viewer";
  if (tripOwnerId === userId) return "owner";
  try {
    const { data, error } = await client.from("trip_shares").select("role").eq("trip_id", tripId).eq("shared_with", userId);
    return !error && data?.some((share) => share.role === "editor") ? "editor" : "viewer";
  } catch {
    // Unknown access is read-only: RLS decides anyway.
    return "viewer";
  }
}

/**
 * Loads both lists of the trip. Without the table it keeps the cached copy on this device.
 * The first time my personal list on the server is empty, the list this device kept before the
 * sync existed is moved into it; the local copy is removed only after the upload succeeded.
 */
export async function loadTripPacking(input: {
  client: PackingClient;
  tripId: string;
  userId: string | null;
  tripOwnerId?: string | null;
  cached?: TripPacking;
}): Promise<TripPacking> {
  const { client, tripId, userId } = input;
  const cachedItems = input.cached?.items ?? [];
  const { data, error } = await client.from(PACKING_TABLE).select("*").eq("trip_id", tripId).order("sort_order", { ascending: true });
  if (error) {
    const missing = isMissingPackingTable(error);
    if (!missing) console.error("Packing list load failed:", error);
    return { items: cachedItems, remote: !missing, role: input.cached?.role ?? (await resolveRole(client, tripId, userId, input.tripOwnerId)) };
  }

  const role = await resolveRole(client, tripId, userId, input.tripOwnerId);
  // RLS already hides other people's personal rows; this keeps a stale cache from showing them.
  const items = ((data ?? []) as PackingItemDb[])
    .map(mapPackingRowFromDb)
    .filter((item) => item.scope === "shared" || item.ownerId === userId);
  if (!userId || items.some((item) => item.scope === "personal")) return { items, remote: true, role };

  const legacy = loadPackingList(tripId);
  const legacyRecords = legacy ? packingListToRecords(legacy, "personal", userId) : [];
  if (!legacy || legacyRecords.length === 0) return { items, remote: true, role };

  const { error: uploadError } = await client.from(PACKING_TABLE).upsert(legacyRecords.map((record) => packingRecordToDb(record, tripId)));
  if (uploadError) {
    // Keep the device copy (and show it); the next load tries again.
    console.error("Packing list upload failed:", uploadError);
    return { items: [...items, ...legacyRecords], remote: true, role };
  }
  savePackingMeta(tripId, "personal", { generatedAt: legacy.generatedAt, weatherSummaries: legacy.weatherSummaries ?? [] });
  removePackingList(tripId);
  return { items: [...items, ...legacyRecords], remote: true, role };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

type WriteClient = {
  from: (table: string) => {
    upsert: (rows: unknown[]) => PromiseLike<{ error: DbError }>;
    update: (row: unknown) => { eq: (column: string, value: string) => PromiseLike<{ error: DbError }> };
    delete: () => { in: (column: string, values: string[]) => PromiseLike<{ error: DbError }> };
  };
};

/**
 * One packing change in Supabase; the same code serves live writes and the offline replay.
 * Payloads: create { tripId, items }, update { itemId, patch }, delete { itemIds }.
 */
export async function writePackingChange(
  client: WriteClient,
  operation: "create" | "update" | "delete",
  payload: Record<string, unknown>,
  idMap: Map<string, string>,
): Promise<DbError> {
  if (operation === "create") {
    const tripId = String(payload.tripId);
    const items = (payload.items as PackingRecord[]) ?? [];
    // Upsert: replaying a create that already reached the server must not fail.
    const { error } = await client.from(PACKING_TABLE).upsert(items.map((item) => packingRecordToDb(item, idMap.get(tripId) ?? tripId)));
    return error;
  }
  if (operation === "update") {
    const { error } = await client.from(PACKING_TABLE).update(packingPatchToDb(payload.patch as PackingPatch)).eq("id", String(payload.itemId));
    return error;
  }
  const itemIds = ((payload.itemIds as string[]) ?? []).map(String);
  if (itemIds.length === 0) return null;
  const { error } = await client.from(PACKING_TABLE).delete().in("id", itemIds);
  return error;
}

// ─── People of the trip ──────────────────────────────────────────────────────

/** The people the trip is shared with (the endpoint answers only the trip owner). */
export async function fetchTripShares(tripId: string): Promise<TripShareUser[]> {
  try {
    const res = await fetch(`/api/trips/${tripId}/shares`, { headers: await authHeaders() });
    if (!res.ok) return [];
    const data = (await res.json()) as { shares?: TripShareUser[] };
    return data.shares ?? [];
  } catch {
    return [];
  }
}
