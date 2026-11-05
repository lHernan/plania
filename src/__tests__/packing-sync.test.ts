// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackingList, PackingRecord, TripPlan } from "@/lib/types";

type Call = { table: string; op: string; payload?: unknown; filters?: [string, unknown][] };

const remote = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: [] as unknown[],
  shareRole: null as string | null,
  selectError: null as { code?: string; message?: string } | null,
  writeError: null as { code?: string; message?: string } | null,
  queue: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => {
  const table = (name: string) => ({
    select: () => {
      const filters: [string, unknown][] = [];
      const query = {
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        order: async () => {
          remote.calls.push({ table: name, op: "select", filters });
          return { data: remote.selectError ? null : remote.rows, error: remote.selectError };
        },
        then: (resolve: (result: unknown) => void) => {
          remote.calls.push({ table: name, op: "select", filters });
          resolve({ data: remote.shareRole ? [{ role: remote.shareRole }] : [], error: null });
        },
      };
      return query;
    },
    upsert: async (payload: unknown) => {
      remote.calls.push({ table: name, op: "upsert", payload });
      return { error: remote.writeError };
    },
    update: (payload: unknown) => ({
      eq: async (column: string, value: unknown) => {
        remote.calls.push({ table: name, op: "update", payload, filters: [[column, value]] });
        return { error: remote.writeError };
      },
    }),
    delete: () => ({
      in: async (column: string, value: unknown) => {
        remote.calls.push({ table: name, op: "delete", filters: [[column, value]] });
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
const { useAuthStore } = await import("@/store/use-auth-store");
const { buildPackingList, loadTripPacking } = await import("@/lib/packing-sync");
const client = (await import("@/lib/supabase")).supabase as never;

const TRIP = "7d1f5a40-0000-4000-8000-000000000001";
const ME = "11111111-0000-4000-8000-000000000001";
const ANA = "22222222-0000-4000-8000-000000000002";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEGACY_KEY = `plania_packing_${TRIP}`;

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, trip_id: TRIP, scope: "shared", owner_id: null, category: "Ropa", name: `Item ${id}`, quantity: 1, reason: null,
  status: "pending", assigned_to: null, sort_order: 0, created_at: "2026-11-01T10:00:00Z", ...extra,
});

const record = (id: string, extra: Partial<PackingRecord> = {}): PackingRecord => ({
  id, name: `Item ${id}`, quantity: 1, reason: "", status: "pending", scope: "shared", category: "Ropa", ownerId: null, assignedTo: null, sortOrder: 0, ...extra,
});

const trip = (items: PackingRecord[], remoteTable = true): TripPlan => ({
  id: TRIP, name: "La Palma", userId: ME, criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [], days: [],
  packing: { items, remote: remoteTable, role: "owner" },
});

const legacyList = (): PackingList => ({
  tripId: TRIP,
  generatedAt: "2026-10-30T09:00:00Z",
  weatherSummaries: [{ city: "Madrid", tempMinC: 5, tempMaxC: 14, rainProbabilityMax: 40 }],
  categories: [
    { name: "Ropa", items: [{ id: "a", name: "Abrigo", quantity: 1, reason: "Frío", status: "packed" }] },
    { name: "Aseo", items: [{ id: "b", name: "Cepillo", quantity: 2, reason: "", status: "pending" }] },
  ],
});

const packingCalls = () => remote.calls.filter((c) => c.table === "packing_items");
const packing = () => useItineraryStore.getState().activeTrip!.packing!;

beforeEach(() => {
  remote.calls = [];
  remote.rows = [];
  remote.shareRole = null;
  remote.selectError = null;
  remote.writeError = null;
  remote.queue = [];
  window.localStorage.clear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useAuthStore.setState({ user: { id: ME, is_anonymous: false } as never });
  useItineraryStore.setState({ activeTrip: trip([]), activeTripIsDraft: false, error: null });
});

describe("loadTripPacking", () => {
  it("loads my personal rows and the shared rows of the trip and maps them to lists", async () => {
    remote.rows = [
      row("p1", { scope: "personal", owner_id: ME, name: "Abrigo", status: "packed", sort_order: 0 }),
      row("p-other", { scope: "personal", owner_id: ANA, name: "Not mine" }),
      row("s1", { name: "Botiquín", category: "Salud", assigned_to: ANA, quantity: 2, reason: "Por si acaso", sort_order: 1 }),
    ];
    const result = await loadTripPacking({ client, tripId: TRIP, userId: ME, tripOwnerId: ME });
    expect(result.remote).toBe(true);
    expect(result.role).toBe("owner");
    expect(result.items.map((i) => i.id)).toEqual(["p1", "s1"]);

    const personal = buildPackingList(TRIP, result.items, "personal", ME)!;
    expect(personal.categories).toEqual([{ name: "Ropa", items: [{ id: "p1", name: "Abrigo", quantity: 1, reason: "", status: "packed", assignedTo: null }] }]);
    const shared = buildPackingList(TRIP, result.items, "shared", ME)!;
    expect(shared.categories).toEqual([{ name: "Salud", items: [{ id: "s1", name: "Botiquín", quantity: 2, reason: "Por si acaso", status: "pending", assignedTo: ANA }] }]);
    expect(packingCalls()[0].filters).toEqual([["trip_id", TRIP]]);
  });

  it("reads the role of a person the trip is shared with from trip_shares", async () => {
    remote.shareRole = "editor";
    expect((await loadTripPacking({ client, tripId: TRIP, userId: ME, tripOwnerId: ANA })).role).toBe("editor");
    remote.shareRole = "viewer";
    expect((await loadTripPacking({ client, tripId: TRIP, userId: ME, tripOwnerId: ANA })).role).toBe("viewer");
    const share = remote.calls.find((c) => c.table === "trip_shares")!;
    expect(share.filters).toEqual([["trip_id", TRIP], ["shared_with", ME]]);
  });

  it("falls back to the device without an error while the table does not exist", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    remote.selectError = { code: "PGRST205", message: "Could not find the table 'public.packing_items' in the schema cache" };
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyList()));
    const result = await loadTripPacking({ client, tripId: TRIP, userId: ME, tripOwnerId: ME, cached: { items: [record("c1")], remote: true, role: "owner" } });
    expect(result).toEqual({ items: [record("c1")], remote: false, role: "owner" });
    expect(consoleError).not.toHaveBeenCalled();
    // The device list is left alone: it is still the list in use.
    expect(window.localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    consoleError.mockRestore();
  });

  it("moves the list stored on this device into my empty personal list once, then removes the local copy", async () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyList()));
    const result = await loadTripPacking({ client, tripId: TRIP, userId: ME, tripOwnerId: ME });
    const upsert = packingCalls().find((c) => c.op === "upsert")!;
    const rows = upsert.payload as Record<string, unknown>[];
    expect(rows.map((r) => [r.trip_id, r.scope, r.owner_id, r.category, r.name, r.quantity, r.status, r.sort_order])).toEqual([
      [TRIP, "personal", ME, "Ropa", "Abrigo", 1, "packed", 0],
      [TRIP, "personal", ME, "Aseo", "Cepillo", 2, "pending", 1],
    ]);
    expect(rows.every((r) => UUID.test(String(r.id)) && r.assigned_to === null)).toBe(true);
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull();
    const personal = buildPackingList(TRIP, result.items, "personal", ME)!;
    expect(personal.weatherSummaries).toEqual(legacyList().weatherSummaries);
    expect(personal.generatedAt).toBe(legacyList().generatedAt);

    // Once the server has my list, nothing is uploaded again.
    remote.calls = [];
    remote.rows = rows.map((r) => ({ ...r, created_at: "2026-11-01T10:00:00Z" }));
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyList()));
    await loadTripPacking({ client, tripId: TRIP, userId: ME, tripOwnerId: ME });
    expect(packingCalls().map((c) => c.op)).toEqual(["select"]);
  });

  it("keeps the local list when moving it to the server fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    remote.writeError = { code: "42501", message: "new row violates row-level security policy" };
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyList()));
    const result = await loadTripPacking({ client, tripId: TRIP, userId: ME, tripOwnerId: ME });
    expect(window.localStorage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(buildPackingList(TRIP, result.items, "personal", ME)!.categories.flatMap((c) => c.items.map((i) => i.name))).toEqual(["Abrigo", "Cepillo"]);
    consoleError.mockRestore();
  });
});

describe("packing list writes", () => {
  it("adds an item to the first category of the chosen list with its scope and owner", async () => {
    useItineraryStore.setState({
      activeTrip: trip([
        record("p1", { scope: "personal", ownerId: ME, category: "Ropa" }),
        record("s1", { category: "Salud", sortOrder: 4 }),
      ]),
    });
    await useItineraryStore.getState().addPackingItem("personal", "Bufanda");
    await useItineraryStore.getState().addPackingItem("shared", "Tiritas");
    const [personalRow, sharedRow] = packingCalls().map((c) => (c.payload as Record<string, unknown>[])[0]);
    expect(packingCalls().map((c) => c.op)).toEqual(["upsert", "upsert"]);
    expect(personalRow).toMatchObject({ trip_id: TRIP, scope: "personal", owner_id: ME, category: "Ropa", name: "Bufanda", status: "pending", assigned_to: null });
    expect(sharedRow).toMatchObject({ trip_id: TRIP, scope: "shared", owner_id: null, category: "Salud", name: "Tiritas", sort_order: 5 });
    expect(UUID.test(String(sharedRow.id))).toBe(true);
    expect(packing().items.map((i) => i.name)).toEqual(["Item p1", "Item s1", "Bufanda", "Tiritas"]);
  });

  it("toggles, assigns and deletes by id", async () => {
    useItineraryStore.setState({ activeTrip: trip([record("s1")]) });
    await useItineraryStore.getState().togglePackingItem("s1");
    await useItineraryStore.getState().assignPackingItem("s1", ANA);
    await useItineraryStore.getState().removePackingItem("s1");
    expect(packingCalls()).toEqual([
      { table: "packing_items", op: "update", payload: { status: "packed" }, filters: [["id", "s1"]] },
      { table: "packing_items", op: "update", payload: { assigned_to: ANA }, filters: [["id", "s1"]] },
      { table: "packing_items", op: "delete", filters: [["id", ["s1"]]] },
    ]);
    expect(packing().items).toEqual([]);
  });

  it("generation replaces only the chosen list", async () => {
    useItineraryStore.setState({
      activeTrip: trip([record("p1", { scope: "personal", ownerId: ME }), record("s1"), record("s2")]),
    });
    await useItineraryStore.getState().replacePackingList("shared", {
      tripId: TRIP, generatedAt: "2026-11-05T08:00:00Z", weatherSummaries: [],
      categories: [{ name: "Documentos", items: [{ id: "x", name: "Seguro", quantity: 1, reason: "Viaje", status: "pending" }] }],
    });
    expect(packingCalls()[0]).toEqual({ table: "packing_items", op: "delete", filters: [["id", ["s1", "s2"]]] });
    expect(packingCalls()[1].op).toBe("upsert");
    expect((packingCalls()[1].payload as Record<string, unknown>[])[0]).toMatchObject({ scope: "shared", owner_id: null, category: "Documentos", name: "Seguro" });
    expect(packing().items.map((i) => i.name)).toEqual(["Item p1", "Seguro"]);
  });

  it("keeps working on this device, without an error, while the table does not exist", async () => {
    useItineraryStore.setState({ activeTrip: trip([record("s1")], false) });
    await useItineraryStore.getState().togglePackingItem("s1");
    expect(packingCalls()).toEqual([]);
    expect(useItineraryStore.getState().error).toBeNull();
    expect(packing().items[0].status).toBe("packed");
  });

  it("keeps the sample trip on this device", async () => {
    useItineraryStore.setState({ activeTripIsDraft: true, activeTrip: trip([record("s1")]) });
    await useItineraryStore.getState().togglePackingItem("s1");
    expect(packingCalls()).toEqual([]);
    expect(remote.queue).toEqual([]);
  });

  it("queues the changes while offline and replays them when back online", async () => {
    useItineraryStore.setState({ activeTrip: trip([record("s1")]) });
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await useItineraryStore.getState().addPackingItem("shared", "Tiritas");
    await useItineraryStore.getState().togglePackingItem("s1");
    await useItineraryStore.getState().removePackingItem("s1");
    expect(packingCalls()).toEqual([]);
    expect(remote.queue.map((e) => [(e as { operation: string }).operation, (e as { target: string }).target])).toEqual([
      ["create", "packing_item"], ["update", "packing_item"], ["delete", "packing_item"],
    ]);

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    await useItineraryStore.getState().syncPendingMutations();
    expect(packingCalls().map((c) => c.op)).toEqual(["upsert", "update", "delete"]);
    expect((packingCalls()[0].payload as { trip_id: string }[])[0].trip_id).toBe(TRIP);
  });

  it("reports other write errors", async () => {
    remote.writeError = { code: "42501", message: "new row violates row-level security policy" };
    useItineraryStore.setState({ activeTrip: trip([record("s1")]) });
    await useItineraryStore.getState().togglePackingItem("s1");
    expect(useItineraryStore.getState().error).toBe("new row violates row-level security policy");
  });
});
