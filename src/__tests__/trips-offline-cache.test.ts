// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineTripCache } from "@/lib/offline-state";

const db = vi.hoisted(() => ({
  trips: [] as Record<string, unknown>[],
  days: [] as Record<string, unknown>[],
  cache: null as OfflineTripCache | null,
  pending: 0,
  /** Tables whose requests fail; supabase-js returns the error instead of throwing. */
  failing: [] as string[],
}));

vi.mock("@/lib/supabase", () => {
  const rows = (table: string, filters: [string, unknown][]) => {
    const source = table === "trips" ? db.trips : table === "trip_days" ? db.days : [];
    return source.filter((row) => filters.every(([c, v]) => row[c] === v));
  };
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      in: () => q,
      order: () => q,
      then: (resolve: (r: unknown) => void) => resolve(db.failing.includes(table)
        ? { data: null, error: { message: "fetch failed" } }
        : { data: rows(table, filters), error: null }),
    };
    return q;
  };
  return {
    supabase: {
      from: query,
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: async () => ({ data: { session: null } }),
        refreshSession: async () => ({ data: {}, error: null }),
      },
    },
  };
});

vi.mock("@/lib/offline-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-state")>()),
  loadOfflineTripCache: vi.fn(async () => (db.cache ? structuredClone(db.cache) : null)),
  saveOfflineTripCache: vi.fn(async (_userId: string, cache: OfflineTripCache) => {
    db.cache = structuredClone(cache);
  }),
  countPendingOfflineMutations: vi.fn(async () => db.pending),
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const trip = (id: string) => ({ id, user_id: "u-owner", name: id, start_date: "2026-12-01", end_date: "2026-12-02", created_at: "2026-10-01" });
const day = (id: string, tripId: string) => ({ id, trip_id: tripId, user_id: "u-owner", date: "2026-12-01", city: "Lisboa" });
const setOnline = (value: boolean) => Object.defineProperty(navigator, "onLine", { value, configurable: true });

beforeEach(() => {
  db.trips = [trip("t-1"), trip("t-2"), trip("t-3")];
  db.days = [day("d-1", "t-1"), day("d-2", "t-2"), day("d-3", "t-3")];
  db.cache = null;
  db.pending = 0;
  db.failing = [];
  setOnline(true);
  useAuthStore.setState({ user: { id: "u-owner" } as never });
  useItineraryStore.setState({ trips: [], activeTrip: null, activeTripIsDraft: false, error: null });
});

// The cache refresh runs at most every few minutes per session, so the test that must not
// cache runs first and the one that caches comes after it.
describe("saving every trip on this device", () => {
  it("waits while edits are still to be synced", async () => {
    db.pending = 1;
    await useItineraryStore.getState().fetchAllTrips();
    await new Promise((r) => setTimeout(r, 20));
    expect(Object.keys(db.cache?.tripPlans ?? {})).toEqual([]);
  });

  it("saves every listed trip, so any of them opens offline", async () => {
    await useItineraryStore.getState().fetchAllTrips();
    await vi.waitFor(() => expect(Object.keys(db.cache?.tripPlans ?? {}).sort()).toEqual(["t-1", "t-2", "t-3"]));
    expect(db.cache?.tripPlans["t-2"].days.map((d) => d.id)).toEqual(["d-2"]);

    setOnline(false);
    await useItineraryStore.getState().fetchActiveTrip("t-3");
    expect(useItineraryStore.getState().activeTrip).toMatchObject({ id: "t-3", days: [{ id: "d-3" }] });
  });

  it("keeps the saved copy when a trip's details fail to load", async () => {
    // Each refresh is due: an hour after the one before.
    const start = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(start + 60 * 60_000);
    await useItineraryStore.getState().fetchAllTrips();
    await vi.waitFor(() => expect(Object.keys(db.cache?.tripPlans ?? {})).toHaveLength(3));

    db.failing = ["trip_days"];
    clock.mockReturnValue(start + 2 * 60 * 60_000);
    await useItineraryStore.getState().fetchAllTrips();
    await new Promise((r) => setTimeout(r, 50));
    clock.mockRestore();
    expect(db.cache?.tripPlans["t-1"].days.map((d) => d.id)).toEqual(["d-1"]);
    expect(db.cache?.tripPlans["t-2"].days.map((d) => d.id)).toEqual(["d-2"]);
  });
});
