// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";

const remote = vi.hoisted(() => ({
  updates: [] as { id: string; row: Record<string, unknown> }[],
  inserts: [] as Record<string, unknown>[][],
  deletes: 0,
  failUpdateOf: null as string | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (row: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          if (remote.failUpdateOf === id) return { error: { message: "update failed" } };
          remote.updates.push({ id, row: JSON.parse(JSON.stringify(row)) });
          return { error: null };
        },
      }),
      insert: async (rows: Record<string, unknown>[]) => {
        remote.inserts.push(rows);
        return { error: null };
      },
      delete: () => {
        remote.deletes += 1;
        return { in: async () => ({ error: null }) };
      },
    }),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const fetchActiveTrip = vi.fn(async () => {});

beforeEach(() => {
  remote.updates = [];
  remote.inserts = [];
  remote.deletes = 0;
  remote.failUpdateOf = null;
  fetchActiveTrip.mockClear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useItineraryStore.setState({
    activeTrip: makeTrip([
      makeDay("d1", [makeActivity("a", { time: "10:00", durationMin: 60, sort_order: 0 }), makeActivity("b", { time: "12:00", durationMin: 60, sort_order: 1 })]),
      makeDay("d2", []),
    ]),
    error: null,
    fetchActiveTrip,
  });
});

describe("applyDayPlan", () => {
  it("updates only the changed fields, inserts suggestions and never deletes", async () => {
    const result = await useItineraryStore.getState().applyDayPlan({
      updates: [
        { activityId: "a", patch: { time: "11:00" } },
        { activityId: "b", patch: { dayId: "d2", time: "09:00", sort_order: 0 } },
      ],
      additions: [{ ...makeActivity("new", { title: "Museo", origin: "suggested", time: "15:00" }), dayId: "d1" }],
    });

    expect(result).toEqual({ ok: true });
    expect(remote.updates).toEqual([
      { id: "a", row: { time: "11:00" } },
      { id: "b", row: { day_id: "d2", time: "09:00", sort_order: 0 } },
    ]);
    expect(remote.inserts).toHaveLength(1);
    expect(remote.inserts[0][0]).toMatchObject({ title: "Museo", origin: "suggested", day_id: "d1" });
    expect(remote.deletes).toBe(0);
    expect(fetchActiveTrip).toHaveBeenCalled();
  });

  it("puts already applied updates back when one fails", async () => {
    remote.failUpdateOf = "b";
    const result = await useItineraryStore.getState().applyDayPlan({
      updates: [
        { activityId: "a", patch: { time: "11:00" } },
        { activityId: "b", patch: { time: "13:00" } },
      ],
      additions: [{ ...makeActivity("new", { title: "Museo" }), dayId: "d1" }],
    });

    expect(result).toEqual({ ok: false, error: "update failed" });
    expect(remote.updates).toEqual([
      { id: "a", row: { time: "11:00" } },
      // Restored to what it was before the genie.
      { id: "a", row: { day_id: "d1", time: "10:00", duration_min: 60, sort_order: 0 } },
    ]);
    expect(remote.inserts).toEqual([]);
  });

  it("does nothing offline", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const result = await useItineraryStore.getState().applyDayPlan({ updates: [{ activityId: "a", patch: { time: "11:00" } }], additions: [] });
    expect(result).toEqual({ ok: false, error: "offline" });
    expect(remote.updates).toEqual([]);
  });
});
