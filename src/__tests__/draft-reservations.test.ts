// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TripPlan } from "@/lib/types";

const remote = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@/lib/supabase", () => {
  const record = (op: string) => {
    remote.calls.push(op);
    return Promise.resolve({ error: { message: 'invalid input syntax for type uuid: "tpl-madrid-seoul"' } });
  };
  return {
    supabase: {
      from: (table: string) => ({
        insert: () => record(`${table}.insert`),
        update: () => ({ eq: () => record(`${table}.update`) }),
        delete: () => ({ eq: () => record(`${table}.delete`) }),
      }),
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

const sample: TripPlan = { id: "tpl-madrid-seoul", name: "Madrid → Seúl", criticalReservations: [], shoppingItems: [], ignoredShoppingSuggestionKeys: [], days: [] };

beforeEach(() => {
  remote.calls = [];
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useItineraryStore.setState({ activeTrip: sample, activeTripIsDraft: true, error: null, fetchActiveTrip: vi.fn(async () => {}) });
});

describe("reservations on the sample trip", () => {
  it("stay on the device: add, check, edit and delete never reach Supabase or raise an error", async () => {
    const store = useItineraryStore.getState();
    await store.addReservation({ title: "Cena en El Jardín", bookingDeadline: "2026-11-01", reservationDate: "2026-11-03", urgency: "safe", status: "pending" });
    const [added] = useItineraryStore.getState().activeTrip!.criticalReservations;
    expect(added.title).toBe("Cena en El Jardín");

    await store.toggleBooking(added.id);
    await store.patchReservation(added.id, { title: "Cena" });
    expect(useItineraryStore.getState().activeTrip!.criticalReservations[0]).toMatchObject({ title: "Cena", status: "booked" });
    await store.removeReservation(added.id);
    expect(useItineraryStore.getState().activeTrip!.criticalReservations).toEqual([]);

    expect(remote.calls).toEqual([]);
    expect(useItineraryStore.getState().error).toBeNull();
  });
});
