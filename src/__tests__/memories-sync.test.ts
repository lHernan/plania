// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  fetchTripMembers,
  loadMemoryAudienceChoice,
  loadTripMemories,
  saveMemoryAudienceChoice,
} from "@/lib/memories-sync";

type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Call = { table: string; ops: [string, ...unknown[]][] };

/** A chainable fake of supabase.from(...): every call is recorded, results come per table. */
function fakeClient(results: Record<string, Result>, rpcResult?: Result) {
  const calls: Call[] = [];
  const rpcCalls: unknown[][] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "order"]) q[op] = (...args: unknown[]) => (call.ops.push([op, ...args]), q);
    q.then = (resolve: (r: Result) => void) => resolve(results[table] ?? { data: [], error: null });
    return q;
  };
  const rpc = async (...args: unknown[]) => (rpcCalls.push(args), rpcResult ?? { data: [], error: null });
  return { client: { from, rpc }, calls, rpcCalls };
}

const TRIP = "11111111-1111-4111-8111-111111111111";
const MEMORY = "22222222-2222-4222-8222-222222222222";

const memoryRow = {
  id: MEMORY,
  trip_id: TRIP,
  activity_id: "act-1",
  author_id: "u1",
  note: "Sunset at the cliffs",
  rating: 5,
  audience: "selected",
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T11:00:00Z",
};
const photoRow = {
  id: "p2",
  memory_id: MEMORY,
  trip_id: TRIP,
  path: `${TRIP}/${MEMORY}/b.webp`,
  caption: null,
  sort_order: 1,
  created_at: "2026-11-01T10:01:00Z",
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("loadTripMemories", () => {
  it("loads the visible memories of the trip with their photos (in order) and audience", async () => {
    const fake = fakeClient({
      memories: { data: [memoryRow], error: null },
      memory_photos: { data: [photoRow, { ...photoRow, id: "p1", path: `${TRIP}/${MEMORY}/a.webp`, sort_order: 0 }], error: null },
      memory_audience: { data: [{ memory_id: MEMORY, user_id: "u2" }], error: null },
    });
    const result = await loadTripMemories({ client: fake.client as never, tripId: TRIP });

    expect(result.remote).toBe(true);
    expect(result.memories).toEqual([
      {
        id: MEMORY,
        tripId: TRIP,
        activityId: "act-1",
        authorId: "u1",
        note: "Sunset at the cliffs",
        rating: 5,
        audience: "selected",
        audienceUserIds: ["u2"],
        photos: [
          { id: "p1", memoryId: MEMORY, tripId: TRIP, path: `${TRIP}/${MEMORY}/a.webp`, caption: null, sortOrder: 0, createdAt: "2026-11-01T10:01:00Z" },
          { id: "p2", memoryId: MEMORY, tripId: TRIP, path: `${TRIP}/${MEMORY}/b.webp`, caption: null, sortOrder: 1, createdAt: "2026-11-01T10:01:00Z" },
        ],
        createdAt: "2026-11-01T10:00:00Z",
        updatedAt: "2026-11-01T11:00:00Z",
      },
    ]);
    expect(fake.calls.find((c) => c.table === "memories")?.ops).toContainEqual(["eq", "trip_id", TRIP]);
    expect(fake.calls.find((c) => c.table === "memory_photos")?.ops).toContainEqual(["eq", "trip_id", TRIP]);
    expect(fake.calls.find((c) => c.table === "memory_audience")?.ops).toContainEqual(["in", "memory_id", [MEMORY]]);
  });

  it("returns an empty, device-only list when the tables do not exist yet", async () => {
    const fake = fakeClient({ memories: { data: null, error: { code: "42P01", message: 'relation "memories" does not exist' } } });
    expect(await loadTripMemories({ client: fake.client as never, tripId: TRIP })).toEqual({ memories: [], remote: false });
  });

  it("keeps the cached memories on any other error and never throws", async () => {
    const cached = [{ id: "m-cached" }] as never;
    const failing = fakeClient({ memories: { data: null, error: { code: "500", message: "boom" } } });
    expect(await loadTripMemories({ client: failing.client as never, tripId: TRIP, cached })).toEqual({ memories: cached, remote: true });

    const throwing = { from: () => { throw new Error("network"); } };
    expect(await loadTripMemories({ client: throwing as never, tripId: TRIP, cached })).toEqual({ memories: cached, remote: true });
  });

  it("skips the audience query when there are no memories", async () => {
    const fake = fakeClient({});
    expect((await loadTripMemories({ client: fake.client as never, tripId: TRIP })).memories).toEqual([]);
    expect(fake.calls.some((c) => c.table === "memory_audience")).toBe(false);
  });
});

describe("fetchTripMembers", () => {
  it("maps the trip_members rpc rows, owner first", async () => {
    const fake = fakeClient({}, {
      data: [
        { user_id: "u2", email: "ana@example.com", is_owner: false },
        { user_id: "u1", email: "me@example.com", is_owner: true },
      ],
      error: null,
    });
    expect(await fetchTripMembers(fake.client as never, TRIP)).toEqual({
      members: [
        { userId: "u1", email: "me@example.com", isOwner: true },
        { userId: "u2", email: "ana@example.com", isOwner: false },
      ],
    });
    expect(fake.rpcCalls).toEqual([["trip_members", { p_trip_id: TRIP }]]);
  });

  it("reports unavailable when the function is missing and failed on other errors", async () => {
    const missing = fakeClient({}, { data: null, error: { code: "PGRST202", message: "Could not find the function public.trip_members" } });
    expect(await fetchTripMembers(missing.client as never, TRIP)).toEqual({ members: [], error: "unavailable" });
    const failing = fakeClient({}, { data: null, error: { code: "500", message: "boom" } });
    expect(await fetchTripMembers(failing.client as never, TRIP)).toEqual({ members: [], error: "failed" });
  });
});

describe("last audience choice", () => {
  it("defaults to the whole trip and remembers the last choice per trip", () => {
    expect(loadMemoryAudienceChoice(TRIP)).toBe("trip");
    saveMemoryAudienceChoice(TRIP, "selected");
    expect(window.localStorage.getItem(`plania_memory_audience_${TRIP}`)).toBe("selected");
    expect(loadMemoryAudienceChoice(TRIP)).toBe("selected");
    expect(loadMemoryAudienceChoice("other-trip")).toBe("trip");
  });

  it("survives unavailable storage", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(loadMemoryAudienceChoice(TRIP)).toBe("trip");
      expect(() => saveMemoryAudienceChoice(TRIP, "selected")).not.toThrow();
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});
