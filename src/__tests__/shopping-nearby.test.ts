import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findNearbyForItems, nearbyAlerts } from "@/lib/shopping/nearby";
import type { ShoppingItem } from "@/lib/types";

const item = (id: string, name: string, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id, name, category: "food", notes: null, preferred_cities: null, preferred_country: null, priority: "medium", status: "pending", ...extra,
});

const here = { lat: 28.6835, lon: -17.7642 };
const mercado = { name: "Mercado de Santa Cruz", area: "Santa Cruz", address: "Av. El Puente", lat: 28.6841, lon: -17.7648, categories: ["commercial", "commercial.marketplace"] };
const superm = { name: "Mercadona", area: "Santa Cruz", address: null, lat: 28.6905, lon: -17.7642, categories: ["commercial", "commercial.supermarket"] };
const regalos = { name: "Artesanía Isla Bonita", area: "Santa Cruz", address: null, lat: 28.6838, lon: -17.7640, categories: ["commercial", "commercial.gift_and_souvenir"] };

describe("findNearbyForItems", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("searches each kind of shop the pending items need and lists the closest matches per item", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { categories } = JSON.parse(init.body as string);
      const places = categories.includes("commercial.gift_and_souvenir") ? [regalos, mercado] : [superm, mercado];
      return new Response(JSON.stringify({ places, attribution: "Powered by Geoapify / OpenStreetMap" }));
    });
    const items = [
      item("mojo", "Mojo picón", { shopCategories: ["commercial.supermarket", "commercial.marketplace"] }),
      item("abuela", "Recuerdo para la abuela", { category: "souvenir", shopCategories: ["commercial.gift_and_souvenir"] }),
      item("done", "Queso", { status: "purchased" }),
    ];

    const result = await findNearbyForItems(items, here);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(init.body as string)]);
    expect(bodies).toEqual([
      ["/api/places/nearby", { lat: here.lat, lon: here.lon, radius_m: 1500, limit: 10, categories: "commercial.supermarket,commercial.marketplace" }],
      ["/api/places/nearby", { lat: here.lat, lon: here.lon, radius_m: 1500, limit: 10, categories: "commercial.gift_and_souvenir" }],
    ]);
    expect(result.matches.mojo.map((m) => [m.name, m.distanceM])).toEqual([["Mercado de Santa Cruz", 90], ["Mercadona", 780]]);
    expect(result.matches.abuela.map((m) => m.name)).toEqual(["Artesanía Isla Bonita"]);
    expect(result.matches.done).toBeUndefined();
    expect(result.places.map((p) => p.name)).toEqual(["Mercadona", "Mercado de Santa Cruz", "Artesanía Isla Bonita"]);
    expect(result.attribution).toBe("Powered by Geoapify / OpenStreetMap");
  });

  it("searches every kind a long list needs, packing them into a few requests", async () => {
    const kinds = [
      "commercial.food_and_drink.spices", "commercial.gift_and_souvenir", "commercial.clothing.shoes", "commercial.health_and_beauty.cosmetics",
      "commercial.books", "commercial.toy_and_game", "commercial.florist", "commercial.jewelry",
    ];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const asked: string[] = JSON.parse(init.body as string).categories.split(",");
      return new Response(JSON.stringify({ places: asked.map((kind, n) => ({ name: kind, area: null, address: null, lat: here.lat + n * 0.0001, lon: here.lon, categories: [kind] })) }));
    });
    const result = await findNearbyForItems(kinds.map((kind, n) => item(`i${n}`, kind, { shopCategories: [kind] })), here);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
    expect(kinds.map((_, n) => result.matches[`i${n}`]?.[0]?.name)).toEqual(kinds);
    expect(result.failed).toBe(false);
  });

  it("says when every search failed", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await findNearbyForItems([item("mojo", "Mojo")], here)).toMatchObject({ matches: {}, failed: true });
  });

  it("skips the search when nothing is pending and survives a failing kind", async () => {
    expect(await findNearbyForItems([item("done", "Queso", { status: "purchased" })], here)).toEqual({ matches: {}, places: [], attribution: null, failed: false });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response(JSON.stringify({ places: [regalos] })));
    const result = await findNearbyForItems([item("mojo", "Mojo"), item("abuela", "Recuerdo", { category: "souvenir", shopCategories: ["commercial.gift_and_souvenir"] })], here);
    expect(Object.keys(result.matches)).toEqual(["abuela"]);
  });
});

describe("nearbyAlerts", () => {
  const matches = {
    mojo: [{ ...mercado, distanceM: 90 }, { ...superm, distanceM: 780 }],
    abuela: [{ ...regalos, distanceM: 30 }],
  };
  const items = [item("mojo", "Mojo picón"), item("abuela", "Recuerdo para la abuela"), item("done", "Queso", { status: "purchased" })];

  it("warns once per item and place a day, only for pending items within walking distance", () => {
    const seen = new Set<string>();
    const first = nearbyAlerts({ items, matches, date: "2026-10-28", seen });
    expect(first.map((a) => [a.itemName, a.place.name])).toEqual([["Recuerdo para la abuela", "Artesanía Isla Bonita"], ["Mojo picón", "Mercado de Santa Cruz"]]);
    expect(nearbyAlerts({ items, matches, date: "2026-10-28", seen })).toEqual([]);
    expect(nearbyAlerts({ items, matches, date: "2026-10-29", seen })).toHaveLength(2);
    expect(nearbyAlerts({ items: items.map((i) => ({ ...i, status: "purchased" as const })), matches, date: "2026-10-30", seen })).toEqual([]);
  });
});
