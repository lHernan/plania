// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { kind: string; table: string; ops: [string, ...unknown[]][] };
type Result = { data: unknown; error: { code?: string; message?: string } | null };

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  /** Result per "<table>:<select|insert|update|delete>"; default { data: [], error: null }. */
  results: {} as Record<string, Result>,
  rpc: [] as unknown[][],
}));

vi.mock("@/lib/supabase", () => {
  const from = (table: string) => {
    const call: Call = { kind: "select", table, ops: [] };
    db.calls.push(call);
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "order", "is"]) q[op] = (...args: unknown[]) => (call.ops.push([op, ...args]), q);
    for (const op of ["insert", "upsert", "update", "delete"]) {
      q[op] = (...args: unknown[]) => ((call.kind = op), call.ops.push([op, ...args]), q);
    }
    q.then = (resolve: (r: Result) => void) => {
      const result = db.results[`${table}:${call.kind}`];
      if (table === "trips" && call.kind === "select" && !result) {
        return resolve({ data: [{ id: "11111111-1111-4111-8111-111111111111", name: "Paris", user_id: "u1" }], error: null });
      }
      resolve(result ?? { data: [], error: null });
    };
    return q;
  };
  return {
    supabase: {
      from,
      storage: { from: () => ({}) },
      rpc: async (...args: unknown[]) => (db.rpc.push(args), db.results["rpc"] ?? { data: null, error: null }),
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: async () => ({ data: { session: null } }),
      },
    },
  };
});

const queued = vi.hoisted(() => [] as { target: string; operation: string; payload: Record<string, unknown> }[]);

vi.mock("@/lib/offline-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-state")>()),
  loadOfflineTripCache: vi.fn(async () => null),
  saveOfflineTripCache: vi.fn(async () => {}),
  enqueueOfflineMutation: vi.fn(async (entry: (typeof queued)[number]) => void queued.push(entry)),
  countPendingOfflineMutations: vi.fn(async () => queued.length),
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const TRIP = "11111111-1111-4111-8111-111111111111";
const FLIGHT = "33333333-3333-4333-8333-333333333333";
const DINNER = "44444444-4444-4444-8444-444444444444";

const activityRow = (id: string, title: string) => ({
  id,
  day_id: "d1",
  trip_id: TRIP,
  user_id: "u1",
  title,
  time: "10:00",
  duration_min: 60,
  category: "other",
  priority: "medium",
  state: "pending",
  sort_order: 0,
});

const plan = (participantIds: string[] = []) => ({
  id: TRIP,
  name: "Paris",
  userId: "u1",
  days: [{ id: "d1", date: "2026-11-15", city: "Madrid", label: "Day 1", userId: "u1", activities: [{ id: FLIGHT, dayId: "d1", title: "Flight", participantIds }] }],
  criticalReservations: [],
  shoppingItems: [],
  ignoredShoppingSuggestionKeys: [],
  memories: [],
});

const participantsOf = (id: string) =>
  useItineraryStore.getState().activeTrip?.days.flatMap((day) => day.activities).find((activity) => activity.id === id)?.participantIds;

beforeEach(() => {
  db.calls = [];
  db.results = {};
  db.rpc = [];
  queued.length = 0;
  window.localStorage.clear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useAuthStore.setState({ user: { id: "u1", is_anonymous: false } as never });
  useItineraryStore.setState({ activeTrip: null, activeTripIsDraft: false, trips: [], activeDayId: "" });
});

describe("loading assignments with the trip", () => {
  it("puts each activity's participants on it and leaves the others shared", async () => {
    db.results["trip_days:select"] = { data: [{ id: "d1", trip_id: TRIP, user_id: "u1", date: "2026-11-15", city: "Madrid", label: "Day 1" }], error: null };
    db.results["activities:select"] = { data: [activityRow(FLIGHT, "Flight TFN-MAD"), activityRow(DINNER, "Dinner")], error: null };
    db.results["activity_participants:select"] = {
      data: [
        { activity_id: FLIGHT, user_id: "u1" },
        { activity_id: FLIGHT, user_id: "u2" },
      ],
      error: null,
    };

    await useItineraryStore.getState().fetchActiveTrip(TRIP);

    expect(participantsOf(FLIGHT)).toEqual(["u1", "u2"]);
    expect(participantsOf(DINNER)).toEqual([]);
    const read = db.calls.find((call) => call.table === "activity_participants");
    expect(read?.ops).toEqual([
      ["select", "activity_id, user_id"],
      ["eq", "trip_id", TRIP],
    ]);
  });

  it("still opens the trip, every activity shared, when the table is missing", async () => {
    db.results["trip_days:select"] = { data: [{ id: "d1", trip_id: TRIP, user_id: "u1", date: "2026-11-15", city: "Madrid", label: "Day 1" }], error: null };
    db.results["activities:select"] = { data: [activityRow(FLIGHT, "Flight")], error: null };
    db.results["activity_participants:select"] = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.activity_participants'" } };

    await useItineraryStore.getState().fetchActiveTrip(TRIP);

    expect(useItineraryStore.getState().hasFetched).toBe(true);
    expect(participantsOf(FLIGHT)).toEqual([]);
  });
});

describe("setActivityParticipants", () => {
  it("replaces the assignment through the rpc, without duplicates", async () => {
    useItineraryStore.setState({ activeTrip: plan() as never });

    const ok = await useItineraryStore.getState().setActivityParticipants("d1", FLIGHT, ["u1", "u2", "u1"]);

    expect(ok).toBe(true);
    expect(db.rpc).toEqual([["set_activity_participants", { p_activity_id: FLIGHT, p_user_ids: ["u1", "u2"] }]]);
    expect(participantsOf(FLIGHT)).toEqual(["u1", "u2"]);
  });

  it("an empty list makes the activity shared again", async () => {
    useItineraryStore.setState({ activeTrip: plan(["u2"]) as never });

    await useItineraryStore.getState().setActivityParticipants("d1", FLIGHT, []);

    expect(db.rpc).toEqual([["set_activity_participants", { p_activity_id: FLIGHT, p_user_ids: [] }]]);
    expect(participantsOf(FLIGHT)).toEqual([]);
  });

  it("rolls back and resolves false when the rpc fails", async () => {
    useItineraryStore.setState({ activeTrip: plan(["u2"]) as never });
    db.results["rpc"] = { data: null, error: { code: "42501", message: "set_activity_participants: not allowed" } };

    const ok = await useItineraryStore.getState().setActivityParticipants("d1", FLIGHT, ["u1"]);

    expect(ok).toBe(false);
    expect(participantsOf(FLIGHT)).toEqual(["u2"]);
    expect(useItineraryStore.getState().error).toBeFalsy();
  });

  it("queues the change offline instead of calling the rpc", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    useItineraryStore.setState({ activeTrip: plan() as never });

    const ok = await useItineraryStore.getState().setActivityParticipants("d1", FLIGHT, ["u2"]);

    expect(ok).toBe(true);
    expect(db.rpc).toEqual([]);
    expect(queued).toEqual([expect.objectContaining({ operation: "update", target: "activity_participants", payload: { dayId: "d1", activityId: FLIGHT, userIds: ["u2"] } })]);
    expect(participantsOf(FLIGHT)).toEqual(["u2"]);
  });

  it("queues the change for an activity created offline that has no server id yet", async () => {
    const trip = plan();
    trip.days[0].activities[0].id = "offline-activity-1-abc";
    useItineraryStore.setState({ activeTrip: trip as never });

    await useItineraryStore.getState().setActivityParticipants("d1", "offline-activity-1-abc", ["u2"]);

    expect(db.rpc).toEqual([]);
    expect(queued).toHaveLength(1);
  });
});
