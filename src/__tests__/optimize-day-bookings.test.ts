// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";
import type { Activity, BookingDetails } from "@/lib/types";

type Op = { op: "delete"; ids: string[] } | { op: "insert"; rows: Record<string, unknown>[] };

const remote = vi.hoisted(() => ({
  ops: [] as Op[],
  insertErrors: [] as (null | { message: string })[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        in: async (_col: string, ids: string[]) => {
          remote.ops.push({ op: "delete", ids });
          return { error: null };
        },
      }),
      insert: async (rows: Record<string, unknown>[] | Record<string, unknown>) => {
        remote.ops.push({ op: "insert", rows: Array.isArray(rows) ? rows : [rows] });
        return { error: remote.insertErrors.shift() ?? null };
      },
    }),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");

const flight: BookingDetails = {
  version: 1,
  type: "flight",
  role: "departure",
  groupId: "g1",
  title: "MAD → SPC",
  reference: "ZZ9TST",
  fieldStatus: { reference: "extracted" },
};

const bookingActivity = makeActivity("b1", { title: "Vuelo MAD → SPC", time: "10:00", origin: "booking", booking: flight });
const manual = makeActivity("m1", { title: "Paseo", time: "17:00" });
const suggested = makeActivity("s1", { title: "Mirador", time: "15:00", origin: "suggested" });

const fetchActiveTrip = vi.fn(async () => {});

function respondWith(optimized: Partial<Activity>[]) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ optimizedActivities: optimized }), { status: 200, headers: { "Content-Type": "application/json" } })
  ) as typeof fetch;
}

const inserts = () => remote.ops.filter((o): o is Extract<Op, { op: "insert" }> => o.op === "insert");
const deletes = () => remote.ops.filter((o): o is Extract<Op, { op: "delete" }> => o.op === "delete");

beforeEach(() => {
  remote.ops = [];
  remote.insertErrors = [];
  fetchActiveTrip.mockClear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useItineraryStore.setState({
    activeTrip: makeTrip([makeDay("d1", [bookingActivity, suggested, manual])]),
    trips: [],
    error: null,
    fetchActiveTrip,
  });
});

describe("optimizeDay with confirmed bookings", () => {
  it("never deletes, moves or re-inserts a confirmed booking", async () => {
    // The optimizer tries to move the flight to 08:00.
    respondWith([
      { ...bookingActivity, time: "08:00", origin: undefined, booking: undefined },
      { ...suggested, time: "12:00", origin: undefined },
      { ...manual, time: "13:30" },
    ]);
    await useItineraryStore.getState().optimizeDay("d1", "es");

    expect(deletes()).toEqual([{ op: "delete", ids: ["s1", "m1"] }]);
    const [insert] = inserts();
    expect(insert.rows.map((r) => r.title)).toEqual(["Mirador", "Paseo"]);
    expect(insert.rows.some((r) => r.title === "Vuelo MAD → SPC")).toBe(false);
  });

  it("still sends the bookings to the optimizer so it plans around them", async () => {
    respondWith([{ ...manual }]);
    await useItineraryStore.getState().optimizeDay("d1", "es");
    const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body));
    expect(body.activities.map((a: Activity) => a.id)).toEqual(["b1", "s1", "m1"]);
  });

  it("keeps accepted suggestions marked as suggested", async () => {
    respondWith([{ ...suggested, origin: undefined }, { ...manual }]);
    await useItineraryStore.getState().optimizeDay("d1", "es");
    const [insert] = inserts();
    expect(insert.rows.find((r) => r.title === "Mirador")).toMatchObject({ origin: "suggested" });
  });

  it("sends no origin or booking columns for manual activities", async () => {
    respondWith([{ ...manual }]);
    await useItineraryStore.getState().optimizeDay("d1", "es");
    const [insert] = inserts();
    const paseo = insert.rows.find((r) => r.title === "Paseo")!;
    expect(Object.keys(paseo)).not.toContain("origin");
    expect(Object.keys(paseo)).not.toContain("booking");
  });

  it("restores the deleted activities when the re-insert fails", async () => {
    remote.insertErrors = [{ message: "insert failed" }];
    respondWith([{ ...suggested }, { ...manual, time: "09:00" }]);
    await useItineraryStore.getState().optimizeDay("d1", "es");

    const [, restore] = inserts();
    expect(restore.rows.map((r) => r.id)).toEqual(["s1", "m1"]);
    expect(restore.rows.find((r) => r.id === "m1")).toMatchObject({ time: "17:00" });
    expect(useItineraryStore.getState().error).toBe("insert failed");
  });
});

describe("optimizeDay row shape (array inserts need identical keys)", () => {
  it("sends no origin column at all when no activity has one (database without the migration)", async () => {
    useItineraryStore.setState({ activeTrip: makeTrip([makeDay("d1", [manual, makeActivity("m2", { title: "Cena" })])]) });
    // The optimizer adds a brand-new activity next to the known ones.
    respondWith([{ ...manual }, { ...makeActivity("ai-gen-1", { title: "Traslado" }) }, { ...makeActivity("m2", { title: "Cena" }) }]);
    await useItineraryStore.getState().optimizeDay("d1", "es");
    const [insert] = inserts();
    expect(insert.rows).toHaveLength(3);
    for (const row of insert.rows) expect(Object.keys(row)).not.toContain("origin");
  });

  it("gives every row an origin when any row has one, defaulting new activities to manual", async () => {
    respondWith([{ ...suggested }, { ...makeActivity("ai-gen-1", { title: "Traslado" }) }, { ...manual }]);
    await useItineraryStore.getState().optimizeDay("d1", "es");
    const [insert] = inserts();
    expect(insert.rows.map((r) => [r.title, r.origin])).toEqual([
      ["Mirador", "suggested"],
      ["Traslado", "manual"],
      ["Paseo", "manual"],
    ]);
  });

  it("restores the originals with identical keys too", async () => {
    remote.insertErrors = [{ message: "insert failed" }];
    respondWith([{ ...suggested }, { ...manual }]);
    await useItineraryStore.getState().optimizeDay("d1", "es");
    const [, restore] = inserts();
    const keySets = restore.rows.map((r) => Object.keys(r).sort().join(","));
    expect(new Set(keySets).size).toBe(1);
    expect(restore.rows.find((r) => r.id === "m1")).toMatchObject({ origin: "manual" });
  });
});

describe("addActivity payload", () => {
  it("sends no origin or booking keys for a regular activity", async () => {
    const { id: _id, tripId: _t, userId: _u, ...rest } = makeActivity("x", { title: "Café" });
    void _id; void _t; void _u;
    await useItineraryStore.getState().addActivity({ ...rest, dayId: "d1" });
    const [insert] = inserts();
    expect(Object.keys(insert.rows[0])).not.toContain("origin");
    expect(Object.keys(insert.rows[0])).not.toContain("booking");
  });
});

describe("mapActivityFromDb", () => {
  it("leaves origin undefined for rows read before the migration", async () => {
    const { mapActivityFromDb } = await import("@/store/use-itinerary-store");
    const row = { id: "a", day_id: "d1", trip_id: "t", user_id: "u", title: "Paseo", time: "10:00", duration_min: 60, category: "other", priority: "medium", state: "pending", sort_order: 0 } as Parameters<typeof mapActivityFromDb>[0];
    expect(mapActivityFromDb(row).origin).toBeUndefined();
    expect(mapActivityFromDb({ ...row, origin: "booking" }).origin).toBe("booking");
  });
});
