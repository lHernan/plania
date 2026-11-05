// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ inserts: [] as { table: string; payload: unknown }[] }));

vi.mock("@/lib/supabase", () => {
  const chain = (table: string): unknown => {
    const result = { data: table === "trips" ? { id: "saved-1" } : [], error: null };
    const q: Record<string, unknown> = {};
    for (const name of ["select", "eq", "in", "order", "is", "update", "delete", "upsert"]) q[name] = () => q;
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

const { useItineraryStore } = await import("@/store/use-itinerary-store");

const draft = (travelContext?: unknown) => ({
  id: "draft-1",
  name: "Oporto",
  startDate: "2026-12-01",
  endDate: "2026-12-02",
  ...(travelContext ? { travelContext } : {}),
  days: [],
  criticalReservations: [],
  shoppingItems: [],
  ignoredShoppingSuggestionKeys: [],
});

beforeEach(() => {
  db.inserts = [];
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("saving a draft", () => {
  it("keeps the travel context chosen while planning", async () => {
    const context = { version: 1, preferences: { minimizeWalking: true, budgetLevel: "low" } };
    useItineraryStore.getState().loadTemplate(draft(context) as never);
    await useItineraryStore.getState().saveDraft();
    const trip = db.inserts.find((insert) => insert.table === "trips")?.payload as Record<string, unknown>;
    expect(trip).toMatchObject({ name: "Oporto", travel_context: context });
  });

  it("sends no travel context when the draft has none, as before", async () => {
    useItineraryStore.getState().loadTemplate(draft() as never);
    await useItineraryStore.getState().saveDraft();
    const trip = db.inserts.find((insert) => insert.table === "trips")?.payload as Record<string, unknown>;
    expect(trip).toEqual({ name: "Oporto", user_id: "u1", start_date: "2026-12-01", end_date: "2026-12-02" });
  });
});
