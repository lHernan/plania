// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineMutationQueueEntry } from "@/lib/offline-state";

// "Nuevo viaje" without dates (trip switcher, landing quick start): the trip is planned by
// number of days (Q12), never dated from today.
const db = vi.hoisted(() => ({
  inserts: [] as { table: string; payload: unknown }[],
  queue: [] as OfflineMutationQueueEntry[],
}));

vi.mock("@/lib/supabase", () => {
  const chain = (table: string): unknown => {
    const result = { data: table === "trips" ? { id: "saved-1" } : [], error: null };
    const q: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "order", "is", "delete", "upsert", "update"]) q[name] = () => q;
    q.insert = (payload: unknown) => (db.inserts.push({ table, payload }), q);
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
  enqueueOfflineMutation: vi.fn(async (entry: OfflineMutationQueueEntry) => {
    db.queue.push(entry);
  }),
  updateOfflineMutation: vi.fn(async () => {}),
  deleteOfflineMutation: vi.fn(async (id: string) => {
    db.queue = db.queue.filter((entry) => entry.id !== id);
  }),
  listOfflineMutations: vi.fn(async () => [...db.queue]),
  countPendingOfflineMutations: vi.fn(async () => db.queue.length),
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const inserted = (table: string) => db.inserts.filter((insert) => insert.table === table).map((insert) => insert.payload);
const tripInsert = () => inserted("trips")[0] as Record<string, unknown>;
const setOnline = (value: boolean) => Object.defineProperty(navigator, "onLine", { value, configurable: true });

beforeEach(() => {
  db.inserts = [];
  db.queue = [];
  window.localStorage.clear();
  setOnline(true);
  useAuthStore.setState({ user: { id: "u1", is_anonymous: false, user_metadata: { preferred_currency: "EUR" } } } as never);
  useItineraryStore.setState({ activeTrip: null, trips: [], fetchActiveTrip: vi.fn(async () => {}) } as never);
});

describe("createTrip without dates", () => {
  it("creates a trip planned by number of days, with one day and no start or end", async () => {
    await useItineraryStore.getState().createTrip("Islandia");
    expect(tripInsert()).toMatchObject({
      name: "Islandia",
      start_date: null,
      end_date: null,
      travel_context: { version: 1, undated: true, currency: "EUR" },
    });
    const days = inserted("trip_days")[0] as Array<Record<string, unknown>>;
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ trip_id: "saved-1" });
  });

  it("keeps a trip with dates dated, as before", async () => {
    await useItineraryStore.getState().createTrip("Budapest", "2026-12-01", "2026-12-02");
    expect(tripInsert()).toMatchObject({ start_date: "2026-12-01", end_date: "2026-12-02" });
    expect((tripInsert().travel_context as Record<string, unknown>).undated).toBeUndefined();
    expect(inserted("trip_days")[0]).toHaveLength(2);
  });

  it("offline, opens the undated trip on this device and syncs it later without dates", async () => {
    setOnline(false);
    await useItineraryStore.getState().createTrip("Islandia");
    const trip = useItineraryStore.getState().activeTrip!;
    expect(trip.startDate).toBeUndefined();
    expect(trip.endDate).toBeUndefined();
    expect(trip.travelContext).toMatchObject({ undated: true });
    expect(trip.days).toHaveLength(1);
    expect(inserted("trips")).toHaveLength(0);

    setOnline(true);
    await useItineraryStore.getState().syncPendingMutations();
    expect(tripInsert()).toMatchObject({ name: "Islandia", start_date: null, end_date: null, travel_context: { undated: true } });
  });

  it("offline, a dated trip still syncs with its dates", async () => {
    setOnline(false);
    await useItineraryStore.getState().createTrip("Budapest", "2026-12-01", "2026-12-02");
    setOnline(true);
    await useItineraryStore.getState().syncPendingMutations();
    expect(tripInsert()).toMatchObject({ start_date: "2026-12-01", end_date: "2026-12-02" });
  });
});
