// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeActivity, makeDay, makeTrip } from "./helpers/dom";
import type { BookingDetails } from "@/lib/types";

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

const inserts = () => remote.ops.filter((o): o is Extract<Op, { op: "insert" }> => o.op === "insert");

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
