// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  trips: [] as Record<string, unknown>[],
  shares: [] as { trip_id: string; shared_with: string }[],
  tripQueries: [] as [string, unknown][][],
}));

vi.mock("@/lib/supabase", () => {
  const rows = (table: string, filters: [string, string, unknown][]) => {
    if (table === "trips") {
      db.tripQueries.push(filters.map(([, c, v]) => [c, v]));
      return db.trips.filter((t) => filters.every(([op, c, v]) => (op === "in" ? (v as unknown[]).includes(t[c]) : t[c] === v)));
    }
    if (table === "trip_shares") return db.shares.filter((s) => filters.every(([, c, v]) => (s as Record<string, unknown>)[c] === v));
    return [];
  };
  const query = (table: string) => {
    const filters: [string, string, unknown][] = [];
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q),
      in: (c: string, v: unknown[]) => (filters.push(["in", c, v]), q),
      order: () => q,
      then: (resolve: (r: unknown) => void) => resolve({ data: rows(table, filters), error: null }),
    };
    return q;
  };
  return {
    supabase: {
      from: query,
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) },
    },
  };
});

vi.mock("@/lib/offline-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-state")>()),
  loadOfflineTripCache: vi.fn(async () => null),
  saveOfflineTripCache: vi.fn(async () => {}),
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const trip = (id: string, owner: string, name: string) => ({ id, user_id: owner, name, start_date: "2026-11-01", end_date: "2026-11-05", created_at: "2026-10-01" });

beforeEach(() => {
  db.trips = [trip("t-own", "u-owner", "Viaje propio"), trip("t-shared", "u-owner", "La Palma")];
  db.shares = [{ trip_id: "t-shared", shared_with: "u-inv" }];
  db.tripQueries = [];
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useItineraryStore.setState({ activeTrip: null, activeTripIsDraft: false });
});

describe("loading the active trip", () => {
  it("opens a trip shared with the account when it has none of its own", async () => {
    useAuthStore.setState({ user: { id: "u-inv" } as never });
    await useItineraryStore.getState().fetchActiveTrip();
    expect(useItineraryStore.getState().activeTrip).toMatchObject({ id: "t-shared", name: "La Palma" });
    // Only trips shared with this account are considered, never every trip RLS lets it read.
    expect(db.tripQueries).toEqual([[["user_id", "u-inv"]], [["id", ["t-shared"]]]]);
  });

  it("still prefers the account's own trips", async () => {
    db.shares.push({ trip_id: "t-shared", shared_with: "u-owner" });
    useAuthStore.setState({ user: { id: "u-owner" } as never });
    await useItineraryStore.getState().fetchActiveTrip();
    expect(db.tripQueries[0]).toEqual([["user_id", "u-owner"]]);
    expect(db.tripQueries).toHaveLength(1);
  });

  it("stays empty when nothing is owned or shared", async () => {
    db.shares = [];
    useAuthStore.setState({ user: { id: "u-nobody" } as never });
    await useItineraryStore.getState().fetchActiveTrip();
    expect(useItineraryStore.getState().activeTrip).toBeNull();
  });
});
