// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";

const db = vi.hoisted(() => ({
  inserts: [] as { table: string; payload: unknown }[],
  updates: [] as { table: string; payload: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase", () => {
  const chain = (table: string): unknown => {
    const result = { data: table === "trips" ? { id: "saved-1" } : [], error: null };
    const q: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "order", "is", "delete", "upsert"]) q[name] = () => q;
    q.insert = (payload: unknown) => (db.inserts.push({ table, payload }), q);
    q.update = (payload: Record<string, unknown>) => (db.updates.push({ table, payload }), q);
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

const { useItineraryStore, mapActivityFromDb } =await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const tripInsert = () => db.inserts.find((insert) => insert.table === "trips")?.payload as Record<string, unknown>;

beforeEach(() => {
  db.inserts = [];
  db.updates = [];
  window.localStorage.clear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useAuthStore.setState({ user: { id: "u1", is_anonymous: false, user_metadata: { preferred_currency: "EUR" } } } as never);
  useItineraryStore.setState({ fetchActiveTrip: vi.fn(async () => {}) } as never);
});

describe("new trips take the preferred currency", () => {
  it("createTrip stores it in the travel context", async () => {
    await useItineraryStore.getState().createTrip("Budapest", "2026-12-01", "2026-12-02");
    expect(tripInsert()).toMatchObject({ name: "Budapest", travel_context: { version: 1, currency: "EUR" } });
  });

  it("saveDraft adds it to the context chosen while planning", async () => {
    const draft = { ...makeTrip([]), id: "draft-1", name: "Oporto", travelContext: { version: 1, travelerCount: 2 } };
    useItineraryStore.getState().loadTemplate(draft as never);
    await useItineraryStore.getState().saveDraft();
    expect(tripInsert().travel_context).toEqual({ version: 1, travelerCount: 2, currency: "EUR" });
  });

  it("saveDraft keeps a currency the draft already has", async () => {
    const draft = { ...makeTrip([]), id: "draft-1", name: "Londres", travelContext: { version: 1, currency: "GBP" } };
    useItineraryStore.getState().loadTemplate(draft as never);
    await useItineraryStore.getState().saveDraft();
    expect(tripInsert().travel_context).toEqual({ version: 1, currency: "GBP" });
  });
});

describe("actual cost", () => {
  const row = {
    id: "a1", day_id: "d1", trip_id: "t", user_id: "u1", title: "Museo", time: "10:00", duration_min: 60,
    category: "sightseeing" as const, priority: "medium" as const, state: "pending" as const, sort_order: 0,
  };

  it("is read from actual_cost and stays undefined when the column is absent", () => {
    expect(mapActivityFromDb({ ...row, expected_cost: 20, actual_cost: 24.5 } as never).actualCost).toBe(24.5);
    expect(mapActivityFromDb(row as never).actualCost).toBeUndefined();
  });

  it("is persisted only when the user sets it", async () => {
    useItineraryStore.setState({ activeTrip: makeTrip([makeDay("d1", [makeActivity("a1", { expectedCost: 20 })])]) } as never);
    await useItineraryStore.getState().patchActivity("d1", "a1", { expectedCost: 25 });
    expect(db.updates.at(-1)?.payload).not.toHaveProperty("actual_cost");
    await useItineraryStore.getState().patchActivity("d1", "a1", { actualCost: 30 });
    expect(db.updates.at(-1)?.payload).toMatchObject({ actual_cost: 30 });
    await useItineraryStore.getState().patchActivity("d1", "a1", { actualCost: null });
    expect(db.updates.at(-1)?.payload).toMatchObject({ actual_cost: null });
  });
});
