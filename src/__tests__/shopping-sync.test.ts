// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShoppingItem, TripPlan } from "@/lib/types";

type Call = { table: string; op: string; payload?: unknown; filter?: [string, unknown] };

const remote = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: [] as unknown[],
  selectError: null as { code?: string; message?: string } | null,
  writeError: null as { code?: string; message?: string } | null,
  queue: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => {
  const table = (name: string) => ({
    select: () => ({
      eq: (column: string, value: unknown) => ({
        order: async () => {
          remote.calls.push({ table: name, op: "select", filter: [column, value] });
          return { data: remote.selectError ? null : remote.rows, error: remote.selectError };
        },
      }),
    }),
    insert: async (payload: unknown) => {
      remote.calls.push({ table: name, op: "insert", payload });
      return { error: remote.writeError };
    },
    upsert: async (payload: unknown) => {
      remote.calls.push({ table: name, op: "upsert", payload });
      return { error: remote.writeError };
    },
    update: (payload: unknown) => ({
      eq: async (column: string, value: unknown) => {
        remote.calls.push({ table: name, op: "update", payload, filter: [column, value] });
        return { error: remote.writeError };
      },
    }),
    delete: () => ({
      eq: async (column: string, value: unknown) => {
        remote.calls.push({ table: name, op: "delete", filter: [column, value] });
        return { error: remote.writeError };
      },
    }),
  });
  return {
    supabase: {
      from: table,
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) },
    },
  };
});

vi.mock("@/lib/offline-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/offline-state")>();
  return {
    ...actual,
    enqueueOfflineMutation: vi.fn(async (entry: unknown) => {
      remote.queue.push(entry);
    }),
    listOfflineMutations: vi.fn(async () => remote.queue),
    countPendingOfflineMutations: vi.fn(async () => remote.queue.length),
    deleteOfflineMutation: vi.fn(async () => {}),
    loadOfflineTripCache: vi.fn(async () => null),
    saveOfflineTripCache: vi.fn(async () => {}),
  };
});

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { loadShoppingItems } = await import("@/lib/shopping/db");
const client = (await import("@/lib/supabase")).supabase as never;

const TRIP = "7d1f5a40-0000-4000-8000-000000000001";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const item = (id: string, name: string, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id, name, category: "food", notes: null, preferred_cities: null, preferred_country: null, priority: "medium", status: "pending", ...extra,
});

const trip = (shoppingItems: ShoppingItem[]): TripPlan => ({
  id: TRIP, name: "La Palma", userId: "owner", criticalReservations: [], shoppingItems, ignoredShoppingSuggestionKeys: [], days: [],
});

const fetchActiveTrip = vi.fn(async () => {});
const shoppingCalls = () => remote.calls.filter((c) => c.table === "shopping_items");

beforeEach(() => {
  remote.calls = [];
  remote.rows = [];
  remote.selectError = null;
  remote.writeError = null;
  remote.queue = [];
  window.localStorage.clear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useItineraryStore.setState({ activeTrip: trip([]), activeTripIsDraft: false, error: null, fetchActiveTrip });
});

describe("shopping list writes", () => {
  it("saves new items in Supabase with the trip, a real id and no author override", async () => {
    await useItineraryStore.getState().addShoppingItems([item("", "Mojo picón", { shopCategories: ["commercial.supermarket"] })]);
    const [saved] = useItineraryStore.getState().activeTrip!.shoppingItems;
    expect(saved.id).toMatch(UUID);
    expect(shoppingCalls()).toEqual([{
      table: "shopping_items",
      op: "upsert",
      payload: [{
        id: saved.id, trip_id: TRIP, name: "Mojo picón", category: "food", notes: null, preferred_cities: null,
        preferred_country: null, priority: "medium", status: "pending", shop_categories: ["commercial.supermarket"],
      }],
    }]);
  });

  it("updates the status when an item is checked, the fields when edited, and deletes by id", async () => {
    useItineraryStore.setState({ activeTrip: trip([item("a1b2c3d4-0000-4000-8000-000000000002", "Imanes")]) });
    const id = "a1b2c3d4-0000-4000-8000-000000000002";
    await useItineraryStore.getState().toggleShoppingItemStatus(id);
    await useItineraryStore.getState().updateShoppingItem(id, { name: "Imanes de nevera", shopCategories: ["commercial.gift_and_souvenir"] });
    await useItineraryStore.getState().removeShoppingItem(id);
    expect(shoppingCalls()).toEqual([
      { table: "shopping_items", op: "update", payload: { status: "purchased" }, filter: ["id", id] },
      { table: "shopping_items", op: "update", payload: { name: "Imanes de nevera", shop_categories: ["commercial.gift_and_souvenir"] }, filter: ["id", id] },
      { table: "shopping_items", op: "delete", filter: ["id", id] },
    ]);
    expect(useItineraryStore.getState().activeTrip!.shoppingItems).toEqual([]);
  });

  it("queues the changes while offline and replays them when back online", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await useItineraryStore.getState().addShoppingItems([item("", "Mojo picón")]);
    const [saved] = useItineraryStore.getState().activeTrip!.shoppingItems;
    await useItineraryStore.getState().toggleShoppingItemStatus(saved.id);
    await useItineraryStore.getState().removeShoppingItem(saved.id);
    expect(shoppingCalls()).toEqual([]);
    expect(remote.queue.map((e) => [(e as { operation: string }).operation, (e as { target: string }).target])).toEqual([
      ["create", "shopping_item"], ["update", "shopping_item"], ["delete", "shopping_item"],
    ]);

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    await useItineraryStore.getState().syncPendingMutations();
    expect(shoppingCalls().map((c) => [c.op, c.filter?.[1] ?? null])).toEqual([
      ["upsert", null], ["update", saved.id], ["delete", saved.id],
    ]);
    expect((shoppingCalls()[0].payload as { trip_id: string }[])[0].trip_id).toBe(TRIP);
  });

  it("keeps the sample trip on this device", async () => {
    useItineraryStore.setState({ activeTripIsDraft: true });
    await useItineraryStore.getState().addShoppingItems([item("", "Mojo picón")]);
    expect(shoppingCalls()).toEqual([]);
    expect(remote.queue).toEqual([]);
    expect(useItineraryStore.getState().activeTrip!.shoppingItems).toHaveLength(1);
  });

  it("keeps working locally, without an error, until the migration is applied", async () => {
    remote.writeError = { code: "PGRST205", message: "Could not find the table 'public.shopping_items' in the schema cache" };
    await useItineraryStore.getState().addShoppingItems([item("", "Mojo picón")]);
    expect(useItineraryStore.getState().error).toBeNull();
    expect(useItineraryStore.getState().activeTrip!.shoppingItems).toHaveLength(1);
  });

  it("reports other write errors", async () => {
    remote.writeError = { code: "42501", message: "new row violates row-level security policy" };
    await useItineraryStore.getState().addShoppingItems([item("", "Mojo picón")]);
    expect(useItineraryStore.getState().error).toBe("new row violates row-level security policy");
  });
});

describe("loadShoppingItems", () => {

  it("reads the trip's list from Supabase", async () => {
    remote.rows = [{ id: "r1", trip_id: TRIP, name: "Queso palmero", category: "food", notes: null, preferred_cities: null, preferred_country: null, priority: "medium", status: "purchased", shop_categories: ["commercial.food_and_drink"] }];
    const result = await loadShoppingItems({ client, tripId: TRIP, cachedItems: [item("old", "Viejo")], canUpload: false });
    expect(result).toEqual({ remote: true, items: [item("r1", "Queso palmero", { status: "purchased", shopCategories: ["commercial.food_and_drink"] })] });
    expect(shoppingCalls().map((c) => c.op)).toEqual(["select"]);
  });

  it("uploads the items that only lived on this device once, giving them real ids", async () => {
    const cached = [item("shopping-local-1", "Mojo picón"), item("a1b2c3d4-0000-4000-8000-000000000003", "Imanes")];
    const first = await loadShoppingItems({ client, tripId: TRIP, cachedItems: cached, canUpload: true });
    expect(first.items.map((i) => i.name)).toEqual(["Mojo picón", "Imanes"]);
    expect(first.items[0].id).toMatch(UUID);
    expect(first.items[1].id).toBe("a1b2c3d4-0000-4000-8000-000000000003");
    const upload = shoppingCalls().find((c) => c.op === "upsert")!;
    expect((upload.payload as { trip_id: string; name: string }[]).map((r) => [r.trip_id, r.name])).toEqual([[TRIP, "Mojo picón"], [TRIP, "Imanes"]]);

    // Deleted everywhere later: the old copy on this device does not come back.
    remote.calls = [];
    expect(await loadShoppingItems({ client, tripId: TRIP, cachedItems: cached, canUpload: true })).toEqual({ remote: true, items: [] });
    expect(shoppingCalls().map((c) => c.op)).toEqual(["select"]);
  });

  it("adds what only this device had even when another device uploaded first", async () => {
    remote.rows = [{ id: "r1", trip_id: TRIP, name: "Turrón", category: "food", notes: null, preferred_cities: null, preferred_country: null, priority: "medium", status: "pending", shop_categories: null }];
    const cached = [item("shopping-local-1", "Imanes"), item("other-id", "turrón")];
    const result = await loadShoppingItems({ client, tripId: TRIP, cachedItems: cached, canUpload: true });
    expect(result.items.map((i) => i.name)).toEqual(["Turrón", "Imanes"]);
    const upload = shoppingCalls().find((c) => c.op === "upsert")!;
    expect((upload.payload as { name: string }[]).map((r) => r.name)).toEqual(["Imanes"]);

    remote.calls = [];
    await loadShoppingItems({ client, tripId: TRIP, cachedItems: cached, canUpload: true });
    expect(shoppingCalls().map((c) => c.op)).toEqual(["select"]);
  });

  it("does not upload for people the trip was shared with", async () => {
    await loadShoppingItems({ client, tripId: TRIP, cachedItems: [item("x", "Mojo")], canUpload: false });
    expect(shoppingCalls().map((c) => c.op)).toEqual(["select"]);
  });

  it("falls back to this device's list while the table does not exist", async () => {
    remote.selectError = { code: "42P01", message: 'relation "shopping_items" does not exist' };
    expect(await loadShoppingItems({ client, tripId: TRIP, cachedItems: [item("x", "Mojo")], canUpload: true })).toEqual({ remote: false, items: [item("x", "Mojo")] });
  });
});
