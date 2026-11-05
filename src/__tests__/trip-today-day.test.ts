// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ trips: [] as Record<string, unknown>[], days: [] as Record<string, unknown>[] }));

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

const { loadOfflineTripCache } = await import("@/lib/offline-state");
const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const day = (id: string, date: string) => ({ id, trip_id: "t1", user_id: "u1", date, city: "Madrid", label: id });

beforeEach(() => {
  // 23:30 UTC on the 15th is already 00:30 on the 16th in Madrid.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T23:30:00Z"));
  db.trips = [{
    id: "t1",
    user_id: "u1",
    name: "Madrid",
    start_date: "2026-11-15",
    end_date: "2026-11-17",
    created_at: "2026-10-01",
    travel_context: { version: 1, arrival: { timeZone: "Europe/Madrid" } },
  }];
  db.days = [day("d15", "2026-11-15"), day("d16", "2026-11-16"), day("d17", "2026-11-17")];
  useAuthStore.setState({ user: { id: "u1" } as never });
  useItineraryStore.setState({ activeTrip: null, activeTripIsDraft: false, activeDayId: "" });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the day a trip opens on", () => {
  it("is today in the trip's time zone, not in UTC", async () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    await useItineraryStore.getState().fetchActiveTrip("t1");
    expect(useItineraryStore.getState().activeDayId).toBe("d16");
  });

  it("is today in the trip's time zone when the trip comes from the offline cache", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const plan = {
      id: "t1",
      name: "Madrid",
      startDate: "2026-11-15",
      endDate: "2026-11-17",
      travelContext: { version: 1, arrival: { timeZone: "Europe/Madrid" } },
      days: db.days.map((d) => ({ id: d.id, date: d.date, city: "Madrid", label: d.label, activities: [], userId: "u1" })),
      criticalReservations: [],
      shoppingItems: [],
      ignoredShoppingSuggestionKeys: [],
    };
    vi.mocked(loadOfflineTripCache).mockResolvedValueOnce({
      trips: [],
      tripPlans: { t1: plan },
      latestTripId: "t1",
    } as never);
    await useItineraryStore.getState().fetchActiveTrip("t1");
    expect(useItineraryStore.getState().activeDayId).toBe("d16");
  });

  it("is the first day of an undated trip, even when a placeholder date is today", async () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    db.trips = [{ ...db.trips[0], start_date: null, end_date: null, travel_context: { version: 1, undated: true, arrival: { timeZone: "Europe/Madrid" } } }];
    await useItineraryStore.getState().fetchActiveTrip("t1");
    expect(useItineraryStore.getState().activeTrip?.travelContext?.undated).toBe(true);
    expect(useItineraryStore.getState().activeDayId).toBe("d15");
  });

  it("never picks an undated trip by its placeholder dates when no trip is asked for", async () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    db.trips = [
      { id: "t0", user_id: "u1", name: "Lisboa", start_date: null, end_date: null, created_at: "2026-11-01", is_favorite: true, travel_context: { version: 1, undated: true } },
      ...db.trips,
    ];
    await useItineraryStore.getState().fetchActiveTrip();
    expect(useItineraryStore.getState().activeTrip?.id).toBe("t1");
    const summaries = useItineraryStore.getState().trips;
    expect(summaries.find((trip) => trip.id === "t1")).toMatchObject({ startDate: "2026-11-15", endDate: "2026-11-17" });
  });
});
