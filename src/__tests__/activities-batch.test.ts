// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";
import type { BookingDetails } from "@/lib/types";

const remote = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[][],
  error: null as null | { message: string },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: async (rows: Record<string, unknown>[]) => {
        remote.inserts.push(rows);
        return { error: remote.error };
      },
    }),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");

const booking: BookingDetails = {
  version: 1,
  type: "car_rental",
  role: "pickup",
  groupId: "g1",
  title: "Car pickup",
  reference: "ABC123",
  fieldStatus: { reference: "extracted" },
};

const fetchActiveTrip = vi.fn(async () => {});

function load() {
  useItineraryStore.setState({
    activeTrip: makeTrip([makeDay("d1", [makeActivity("existing")]), makeDay("d2", [])]),
    trips: [],
    error: null,
    fetchActiveTrip,
  });
}

const allIds = () => useItineraryStore.getState().activeTrip!.days.flatMap((d) => d.activities.map((a) => a.id));

beforeEach(() => {
  remote.inserts = [];
  remote.error = null;
  fetchActiveTrip.mockClear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  load();
});

describe("addActivitiesBatch", () => {
  it("inserts every activity in one request with client ids, on their own days", async () => {
    const result = await useItineraryStore.getState().addActivitiesBatch([
      { ...makeActivity("x", { title: "Pickup", origin: "booking", booking }), dayId: "d1" },
      { ...makeActivity("y", { title: "Beach", origin: "suggested" }), dayId: "d2" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ids).toHaveLength(2);
    expect(remote.inserts).toHaveLength(1);
    const [rows] = remote.inserts;
    expect(rows.map((r) => r.id)).toEqual(result.ids);
    expect(rows.map((r) => r.day_id)).toEqual(["d1", "d2"]);
    expect(rows[0]).toMatchObject({ origin: "booking", booking, title: "Pickup" });
    expect(rows[1]).toMatchObject({ origin: "suggested", title: "Beach" });
    expect(fetchActiveTrip).toHaveBeenCalledTimes(1);
  });

  it("shows the new activities in the itinerary right away", async () => {
    const result = await useItineraryStore.getState().addActivitiesBatch([
      { ...makeActivity("x", { title: "Pickup" }), dayId: "d2" },
    ]);
    if (!result.ok) throw new Error("expected ok");
    const d2 = useItineraryStore.getState().activeTrip!.days.find((d) => d.id === "d2")!;
    expect(d2.activities.map((a) => a.id)).toEqual(result.ids);
  });

  it("leaves nothing behind when the insert fails", async () => {
    remote.error = { message: 'column "booking" does not exist' };
    const before = allIds();
    const result = await useItineraryStore.getState().addActivitiesBatch([
      { ...makeActivity("x"), dayId: "d1" },
      { ...makeActivity("y"), dayId: "d2" },
    ]);
    expect(result).toEqual({ ok: false, error: 'column "booking" does not exist' });
    expect(allIds()).toEqual(before);
    expect(fetchActiveTrip).not.toHaveBeenCalled();
  });

  it("refuses to run offline without touching the itinerary", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const before = allIds();
    const result = await useItineraryStore.getState().addActivitiesBatch([{ ...makeActivity("x"), dayId: "d1" }]);
    expect(result).toEqual({ ok: false, error: "offline" });
    expect(remote.inserts).toHaveLength(0);
    expect(allIds()).toEqual(before);
  });

  it("does nothing for an empty batch", async () => {
    expect(await useItineraryStore.getState().addActivitiesBatch([])).toEqual({ ok: true, ids: [] });
    expect(remote.inserts).toHaveLength(0);
  });
});
