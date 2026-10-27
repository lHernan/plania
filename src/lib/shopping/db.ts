import type { ShoppingCategory, ShoppingItem } from "@/lib/types";

/** Supabase persistence of the shopping list (table from src/lib/shopping_items_migration.sql). */

export const SHOPPING_TABLE = "shopping_items";

export type ShoppingItemDb = {
  id: string;
  trip_id: string;
  user_id?: string | null;
  name: string;
  category: ShoppingCategory;
  notes: string | null;
  preferred_cities: string[] | null;
  preferred_country: string | null;
  priority: ShoppingItem["priority"];
  status: ShoppingItem["status"];
  shop_categories: string[] | null;
  created_at?: string;
};

type DbError = { code?: string; message?: string } | null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (id: string) => UUID_RE.test(id);

/** The migration was not applied yet: the list keeps working on this device only. */
export function isMissingShoppingTable(error: DbError): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /shopping_items/.test(error.message ?? "") && /does not exist|schema cache/i.test(error.message ?? "");
}

export function mapShoppingItemFromDb(row: ShoppingItemDb): ShoppingItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    notes: row.notes,
    preferred_cities: row.preferred_cities,
    preferred_country: row.preferred_country,
    priority: row.priority,
    status: row.status,
    ...(row.shop_categories?.length ? { shopCategories: row.shop_categories } : {}),
  };
}

/** user_id is left to the database default (the signed-in caller). */
export function shoppingItemToDb(item: ShoppingItem, tripId: string): Omit<ShoppingItemDb, "user_id" | "created_at"> {
  return {
    id: item.id,
    trip_id: tripId,
    name: item.name,
    category: item.category,
    notes: item.notes,
    preferred_cities: item.preferred_cities,
    preferred_country: item.preferred_country,
    priority: item.priority,
    status: item.status,
    shop_categories: item.shopCategories ?? null,
  };
}

export function shoppingPatchToDb(patch: Partial<ShoppingItem>): Partial<ShoppingItemDb> {
  const row: Partial<ShoppingItemDb> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.preferred_cities !== undefined) row.preferred_cities = patch.preferred_cities;
  if (patch.preferred_country !== undefined) row.preferred_country = patch.preferred_country;
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.status !== undefined) row.status = patch.status;
  if ("shopCategories" in patch) row.shop_categories = patch.shopCategories ?? null;
  return row;
}

const uploadedKey = (tripId: string) => `plania-shopping-uploaded:${tripId}`;

function wasUploaded(tripId: string): boolean {
  try {
    return window.localStorage.getItem(uploadedKey(tripId)) === "1";
  } catch {
    return false;
  }
}

function markUploaded(tripId: string) {
  try {
    window.localStorage.setItem(uploadedKey(tripId), "1");
  } catch {
    // Without storage the upload may be offered again; the insert is an upsert by id.
  }
}

type ShoppingClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (column: string, options: { ascending: boolean }) => PromiseLike<{ data: unknown[] | null; error: DbError }>;
      };
    };
    upsert: (rows: unknown[]) => PromiseLike<{ error: DbError }>;
  };
};

/**
 * Loads the trip's list from Supabase. The first time a trip owner opens it, items that
 * only lived on this device are uploaded once. Without the table it falls back to the cache.
 */
export async function loadShoppingItems(input: {
  client: ShoppingClient;
  tripId: string;
  cachedItems: ShoppingItem[];
  canUpload: boolean;
}): Promise<{ items: ShoppingItem[]; remote: boolean }> {
  const { data, error } = await input.client
    .from(SHOPPING_TABLE)
    .select("*")
    .eq("trip_id", input.tripId)
    .order("created_at", { ascending: true });
  if (error) {
    if (!isMissingShoppingTable(error)) console.error("Shopping list load failed:", error);
    return { items: input.cachedItems, remote: !isMissingShoppingTable(error) };
  }

  const rows = (data ?? []) as ShoppingItemDb[];
  if (rows.length > 0 || input.cachedItems.length === 0 || !input.canUpload || wasUploaded(input.tripId)) {
    if (rows.length > 0) markUploaded(input.tripId);
    return { items: rows.map(mapShoppingItemFromDb), remote: true };
  }

  const items = input.cachedItems.map((item) => (isUuid(item.id) ? item : { ...item, id: crypto.randomUUID() }));
  const { error: uploadError } = await input.client.from(SHOPPING_TABLE).upsert(items.map((item) => shoppingItemToDb(item, input.tripId)));
  if (uploadError) {
    console.error("Shopping list upload failed:", uploadError);
    return { items: input.cachedItems, remote: true };
  }
  markUploaded(input.tripId);
  return { items, remote: true };
}
