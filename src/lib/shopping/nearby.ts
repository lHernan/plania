import { haversineKm } from "@/lib/day-genius/context";
import { placeMatchesKinds, shopKindsFor } from "@/lib/shopping/shop-kinds";
import type { ShoppingItem } from "@/lib/types";

/**
 * Finds shops near the traveler that sell the kinds of things on the shopping list.
 * Places come from OpenStreetMap categories: they usually sell that kind of thing,
 * never a confirmed stock.
 */

export type NearbyPlace = {
  name: string;
  area: string | null;
  address: string | null;
  lat: number;
  lon: number;
  categories: string[];
};

export type NearbyMatch = NearbyPlace & { distanceM: number };

export type NearbyResult = {
  /** Closest matching places per pending item id. */
  matches: Record<string, NearbyMatch[]>;
  /** Every place found, for the shopping suggestions. */
  places: NearbyPlace[];
  attribution: string | null;
};

export const SEARCH_RADIUS_M = 1500;
/** Close enough to walk there now. */
export const ALERT_RADIUS_M = 300;
const PER_SEARCH = 10;
const MAX_SEARCHES = 6;
const MATCHES_PER_ITEM = 2;

type Position = { lat: number; lon: number };

const distanceM = (from: Position, to: Position) => Math.round((haversineKm({ lat: from.lat, lng: from.lon }, { lat: to.lat, lng: to.lon }) * 1000) / 10) * 10;

async function searchKinds(kinds: string[], at: Position): Promise<{ places: NearbyPlace[]; attribution: string | null }> {
  const response = await fetch("/api/places/nearby", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat: at.lat, lon: at.lon, radius_m: SEARCH_RADIUS_M, limit: PER_SEARCH, categories: kinds.join(",") }),
  });
  const data = (await response.json()) as { places?: Partial<NearbyPlace>[]; attribution?: string | null };
  const places = (Array.isArray(data.places) ? data.places : []).filter(
    (p): p is NearbyPlace => typeof p.name === "string" && typeof p.lat === "number" && typeof p.lon === "number" && Array.isArray(p.categories),
  );
  return { places, attribution: data.attribution ?? null };
}

export async function findNearbyForItems(items: ShoppingItem[], at: Position): Promise<NearbyResult> {
  const pending = items.filter((item) => item.status === "pending");
  // Items that need the same kinds of shop share one search.
  const searches = new Map<string, string[]>();
  for (const item of pending) {
    const kinds = shopKindsFor(item);
    searches.set(kinds.join(","), kinds);
  }
  const kindSets = [...searches.values()].slice(0, MAX_SEARCHES);
  const results = await Promise.allSettled(kindSets.map((kinds) => searchKinds(kinds, at)));

  const places: NearbyPlace[] = [];
  const seen = new Set<string>();
  let attribution: string | null = null;
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    attribution ??= result.value.attribution;
    for (const place of result.value.places) {
      const key = `${place.name}|${place.lat}|${place.lon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(place);
    }
  }

  const matches: Record<string, NearbyMatch[]> = {};
  for (const item of pending) {
    const kinds = shopKindsFor(item);
    const found = places
      .filter((place) => placeMatchesKinds(place.categories, kinds))
      .map((place) => ({ ...place, distanceM: distanceM(at, place) }))
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, MATCHES_PER_ITEM);
    if (found.length > 0) matches[item.id] = found;
  }
  return { matches, places, attribution };
}

export type NearbyAlert = { key: string; itemId: string; itemName: string; place: NearbyMatch };

/**
 * New "you can buy it here" notices: the closest place of each pending item when it is
 * within walking distance, once per item and place per day (`seen` keeps what was shown).
 */
export function nearbyAlerts(input: {
  items: ShoppingItem[];
  matches: Record<string, NearbyMatch[]>;
  date: string;
  seen: Set<string>;
}): NearbyAlert[] {
  const alerts: NearbyAlert[] = [];
  for (const item of input.items) {
    if (item.status !== "pending") continue;
    const closest = input.matches[item.id]?.[0];
    if (!closest || closest.distanceM > ALERT_RADIUS_M) continue;
    const key = `${input.date}|${item.id}|${closest.name}`;
    if (input.seen.has(key)) continue;
    input.seen.add(key);
    alerts.push({ key, itemId: item.id, itemName: item.name, place: closest });
  }
  return alerts.sort((a, b) => a.place.distanceM - b.place.distanceM);
}
