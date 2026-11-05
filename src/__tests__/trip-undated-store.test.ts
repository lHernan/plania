// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type Write = { table: string; op: "insert" | "update"; payload: unknown; filters: [string, unknown][] };
const db = vi.hoisted(() => ({ writes: [] as Write[] }));

vi.mock("@/lib/supabase", () => {
  const chain = (table: string): unknown => {
    const result = { data: table === "trips" ? { id: "saved-1" } : [], error: null };
    let write: Write | null = null;
    const q: Record<string, unknown> = {};
    for (const name of ["select", "in", "order", "is", "delete", "upsert"]) q[name] = () => q;
    q.eq = (column: string, value: unknown) => (write?.filters.push([column, value]), q);
    q.insert = (payload: unknown) => ((write = { table, op: "insert", payload, filters: [] }), db.writes.push(write), q);
    q.update = (payload: unknown) => ((write = { table, op: "update", payload, filters: [] }), db.writes.push(write), q);
    q.single = async () => result;
    q.maybeSingle = async () => result;
    q.then = (resolve: (r: unknown) => void) => resolve(result);
    return q;
  };
  return {
    supabase: {
      from: chain,
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: async () => ({ data: { session: { access_token: "tok", user: { id: "u1" } } } }),
      },
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

const day = (id: string, date: string) => ({ id, date, city: "Lisboa", label: id, activities: [], userId: "u1" });

const undatedTrip = () => ({
  id: "t1",
  name: "Lisboa",
  userId: "u1",
  travelContext: { version: 1 as const, undated: true, currency: "EUR" },
  days: [day("d1", "2026-11-05"), day("d2", "2026-11-06"), day("d3", "2026-11-07")],
  criticalReservations: [],
  shoppingItems: [],
  ignoredShoppingSuggestionKeys: [],
});

beforeEach(() => {
  db.writes = [];
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useAuthStore.setState({ user: { id: "u1", is_anonymous: false } as never });
  useItineraryStore.setState({ activeTrip: null, activeTripIsDraft: false, trips: [], activeDayId: "" });
});

describe("saving an undated draft", () => {
  it("writes no trip dates and keeps the undated flag", async () => {
    useItineraryStore.getState().loadTemplate({ ...undatedTrip(), id: "draft-1" } as never);
    await useItineraryStore.getState().saveDraft();
    const trip = db.writes.find((w) => w.table === "trips" && w.op === "insert")?.payload as Record<string, unknown>;
    expect(trip).toMatchObject({ start_date: null, end_date: null, travel_context: { version: 1, undated: true, currency: "EUR" } });
    const days = db.writes.find((w) => w.table === "trip_days" && w.op === "insert")?.payload as { date: string }[];
    expect(days.map((d) => d.date)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07"]);
  });
});

describe("setting the dates of an undated trip", () => {
  it("re-dates every day in order from the start, updates the trip range and clears the flag", async () => {
    useItineraryStore.setState({ activeTrip: undatedTrip(), activeDayId: "d1" } as never);
    const result = await useItineraryStore.getState().setTripDates("2027-03-30");
    expect(result).toEqual({});

    const dayUpdates = db.writes.filter((w) => w.table === "trip_days" && w.op === "update");
    expect(dayUpdates.map((w) => [w.filters.find(([c]) => c === "id")?.[1], w.payload])).toEqual([
      ["d1", { date: "2027-03-30" }],
      ["d2", { date: "2027-03-31" }],
      ["d3", { date: "2027-04-01" }],
    ]);
    const tripUpdate = db.writes.find((w) => w.table === "trips" && w.op === "update");
    expect(tripUpdate?.payload).toEqual({
      start_date: "2027-03-30",
      end_date: "2027-04-01",
      travel_context: { version: 1, currency: "EUR" },
    });
    expect(tripUpdate?.filters).toEqual(expect.arrayContaining([["id", "t1"], ["user_id", "u1"]]));

    const { activeTrip, trips } = useItineraryStore.getState();
    expect(activeTrip?.days.map((d) => d.date)).toEqual(["2027-03-30", "2027-03-31", "2027-04-01"]);
    expect(activeTrip?.startDate).toBe("2027-03-30");
    expect(activeTrip?.endDate).toBe("2027-04-01");
    expect(activeTrip?.travelContext).toEqual({ version: 1, currency: "EUR" });
    expect(trips.find((t) => t.id === "t1")).toMatchObject({ startDate: "2027-03-30", endDate: "2027-04-01" });
  });

  it("needs a connection and writes nothing offline", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    useItineraryStore.setState({ activeTrip: undatedTrip() } as never);
    expect(await useItineraryStore.getState().setTripDates("2027-03-30")).toEqual({ error: "offline" });
    expect(db.writes).toEqual([]);
    expect(useItineraryStore.getState().activeTrip?.travelContext?.undated).toBe(true);
  });

  it("only changes the device copy of a draft", async () => {
    useItineraryStore.setState({ activeTrip: undatedTrip(), activeTripIsDraft: true } as never);
    expect(await useItineraryStore.getState().setTripDates("2027-03-30")).toEqual({});
    expect(db.writes).toEqual([]);
    expect(useItineraryStore.getState().activeTrip?.days.map((d) => d.date)).toEqual(["2027-03-30", "2027-03-31", "2027-04-01"]);
    expect(useItineraryStore.getState().activeTrip?.travelContext).toEqual({ version: 1, currency: "EUR" });
  });
});
