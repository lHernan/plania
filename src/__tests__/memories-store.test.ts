// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { kind: string; table: string; ops: [string, ...unknown[]][] };
type Result = { data: unknown; error: { code?: string; message?: string } | null };

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  storage: [] as { kind: string; bucket: string; args: unknown[] }[],
  /** Result per "<table>:<select|insert|update|delete>"; default { data: [], error: null }. */
  results: {} as Record<string, Result>,
  uploadErrors: [] as (string | null)[],
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
      const key = `${table}:${call.kind}`;
      const result = db.results[key];
      if (table === "trips" && call.kind === "select" && !result) {
        return resolve({ data: [{ id: "11111111-1111-4111-8111-111111111111", name: "Islandia", user_id: "u1" }], error: null });
      }
      resolve(result ?? { data: [], error: null });
    };
    return q;
  };
  const bucket = (name: string) => ({
    upload: async (...args: unknown[]) => {
      db.storage.push({ kind: "upload", bucket: name, args });
      const message = db.uploadErrors.shift() ?? null;
      return { data: message ? null : {}, error: message ? { message } : null };
    },
    remove: async (...args: unknown[]) => (db.storage.push({ kind: "remove", bucket: name, args }), { data: [], error: null }),
  });
  return {
    supabase: {
      from,
      storage: { from: bucket },
      rpc: async (...args: unknown[]) => (db.rpc.push(args), db.results["rpc"] ?? { data: [], error: null }),
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: async () => ({ data: { session: null } }),
      },
    },
  };
});

vi.mock("@/lib/image-compress", () => ({
  compressImage: vi.fn(async (file: File) => new File([new Uint8Array(10)], file.name.replace(/\.\w+$/, ".webp"), { type: "image/webp" })),
}));

vi.mock("@/lib/offline-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-state")>()),
  loadOfflineTripCache: vi.fn(async () => null),
  saveOfflineTripCache: vi.fn(async () => {}),
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");
const { compressImage } = await import("@/lib/image-compress");

const TRIP = "11111111-1111-4111-8111-111111111111";
const MEMORY = "22222222-2222-4222-8222-222222222222";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const memory = (overrides: Record<string, unknown> = {}) => ({
  id: MEMORY,
  tripId: TRIP,
  activityId: null,
  authorId: "u1",
  note: "Glaciar",
  rating: 4,
  audience: "trip",
  audienceUserIds: [],
  photos: [
    { id: "p1", memoryId: MEMORY, tripId: TRIP, path: `${TRIP}/${MEMORY}/a.webp`, caption: null, sortOrder: 0 },
    { id: "p2", memoryId: MEMORY, tripId: TRIP, path: `${TRIP}/${MEMORY}/b.webp`, caption: null, sortOrder: 1 },
  ],
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  ...overrides,
});
const plan = (overrides: Record<string, unknown> = {}) => ({
  id: TRIP,
  name: "Islandia",
  userId: "u1",
  days: [{ id: "d1", date: "2026-11-01", city: "Reykjavik", label: "Day 1", activities: [{ id: "act-1", dayId: "d1", title: "Glaciar" }] }],
  criticalReservations: [],
  shoppingItems: [],
  ignoredShoppingSuggestionKeys: [],
  memories: [],
  ...overrides,
});
const image = (name = "a.jpg") => new File([new Uint8Array(100)], name, { type: "image/jpeg" });
const writes = () => db.calls.filter((c) => c.kind !== "select");
const op = (call: Call | undefined, name: string) => call?.ops.find(([n]) => n === name)?.slice(1);

beforeEach(() => {
  db.calls = [];
  db.storage = [];
  db.results = {};
  db.uploadErrors = [];
  db.rpc = [];
  vi.mocked(compressImage).mockClear();
  window.localStorage.clear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useAuthStore.setState({ user: { id: "u1", is_anonymous: false } as never });
  useItineraryStore.setState({ activeTrip: null, activeTripIsDraft: false, trips: [], activeDayId: "" });
});

describe("loading memories with the trip", () => {
  it("puts the visible memories on the active trip", async () => {
    db.results["memories:select"] = {
      data: [{ id: MEMORY, trip_id: TRIP, activity_id: null, author_id: "u2", note: "Hola", rating: null, audience: "trip", created_at: "c", updated_at: "u" }],
      error: null,
    };
    await useItineraryStore.getState().fetchActiveTrip(TRIP);
    expect(useItineraryStore.getState().activeTrip?.memories).toEqual([
      expect.objectContaining({ id: MEMORY, authorId: "u2", note: "Hola", audience: "trip", audienceUserIds: [], photos: [] }),
    ]);
  });

  it("still loads the trip, with no memories, when the tables are missing", async () => {
    db.results["memories:select"] = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.memories' in the schema cache" } };
    await useItineraryStore.getState().fetchActiveTrip(TRIP);
    expect(useItineraryStore.getState().activeTrip).toMatchObject({ id: TRIP, memories: [] });
    expect(useItineraryStore.getState().hasFetched).toBe(true);
  });
});

describe("createMemory", () => {
  it("inserts the memory without author (database default), then its audience, photos and photo rows", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    const result = await useItineraryStore.getState().createMemory({
      activityId: "act-1",
      note: "  Glaciar  ",
      rating: 5,
      audience: "selected",
      audienceUserIds: ["u2", "u1", "u2"],
      photos: [image("a.jpg"), image("b.jpg")],
    });

    expect(result.error).toBeUndefined();
    expect(result.failedPhotos).toEqual([]);
    const memoryInsert = op(writes().find((c) => c.table === "memories"), "insert")?.[0] as Record<string, unknown>;
    expect(memoryInsert).toEqual({ id: result.memoryId, trip_id: TRIP, activity_id: "act-1", note: "Glaciar", rating: 5, audience: "selected" });
    expect(memoryInsert).not.toHaveProperty("author_id");
    // The author always sees the memory: only the other chosen members get audience rows.
    expect(op(writes().find((c) => c.table === "memory_audience"), "insert")?.[0]).toEqual([{ memory_id: result.memoryId, user_id: "u2" }]);

    const uploads = db.storage.filter((s) => s.kind === "upload");
    expect(uploads).toHaveLength(2);
    for (const upload of uploads) {
      expect(upload.bucket).toBe("trip-memories");
      expect(upload.args[0]).toMatch(new RegExp(`^${TRIP}/${result.memoryId}/${UUID}\\.webp$`));
      expect((upload.args[1] as File).type).toBe("image/webp");
      expect(upload.args[2]).toMatchObject({ contentType: "image/webp", upsert: false });
    }
    expect(compressImage).toHaveBeenCalledTimes(2);
    const photoRows = writes().filter((c) => c.table === "memory_photos").map((c) => (op(c, "insert")?.[0] as Record<string, unknown>[])[0]);
    expect(photoRows.map((row) => [row.memory_id, row.trip_id, row.path, row.sort_order])).toEqual([
      [result.memoryId, TRIP, uploads[0].args[0], 0],
      [result.memoryId, TRIP, uploads[1].args[0], 1],
    ]);

    const created = useItineraryStore.getState().activeTrip?.memories?.[0];
    expect(created).toMatchObject({ id: result.memoryId, authorId: "u1", audience: "selected", audienceUserIds: ["u2"], note: "Glaciar" });
    expect(created?.photos).toHaveLength(2);
    expect(window.localStorage.getItem(`plania_memory_audience_${TRIP}`)).toBe("selected");
  });

  it("adds no audience rows for a memory shared with the whole trip", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    const result = await useItineraryStore.getState().createMemory({ note: "Todos", audience: "trip", audienceUserIds: ["u2"] });
    expect(result.error).toBeUndefined();
    expect(writes().map((c) => c.table)).toEqual(["memories"]);
    expect(op(writes()[0], "insert")?.[0]).toMatchObject({ activity_id: null, audience: "trip" });
  });

  it("keeps the memory and reports the photos that failed", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    db.uploadErrors = [null, "Payload too large"];
    const result = await useItineraryStore.getState().createMemory({ audience: "trip", photos: [image("a.jpg"), image("b.jpg")] });
    expect(result.error).toBeUndefined();
    expect(result.failedPhotos).toEqual([1]);
    expect(useItineraryStore.getState().activeTrip?.memories?.[0]?.photos).toHaveLength(1);
    expect(writes().filter((c) => c.table === "memory_photos")).toHaveLength(1);
  });

  it("removes the uploaded object when its photo row cannot be saved", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    db.results["memory_photos:insert"] = { data: null, error: { code: "42501", message: "denied" } };
    const result = await useItineraryStore.getState().createMemory({ audience: "trip", photos: [image()] });
    expect(result.failedPhotos).toEqual([0]);
    const uploaded = db.storage.find((s) => s.kind === "upload")?.args[0];
    expect(db.storage.find((s) => s.kind === "remove")?.args).toEqual([[uploaded]]);
  });

  it("rejects an activity of another trip or an invalid rating before any request", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    expect(await useItineraryStore.getState().createMemory({ activityId: "elsewhere", audience: "trip" })).toEqual({ error: "invalid" });
    expect(await useItineraryStore.getState().createMemory({ rating: 6, audience: "trip" })).toEqual({ error: "invalid" });
    expect(db.calls).toEqual([]);
  });

  it("reports unavailable when the migration is missing", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    db.results["memories:insert"] = { data: null, error: { code: "42P01", message: 'relation "memories" does not exist' } };
    expect(await useItineraryStore.getState().createMemory({ audience: "trip" })).toEqual({ error: "unavailable" });
    expect(useItineraryStore.getState().activeTrip?.memories).toEqual([]);
  });
});

describe("changing a memory", () => {
  it("updates only the memories row of an own memory", async () => {
    useItineraryStore.setState({ activeTrip: plan({ memories: [memory()] }) } as never);
    expect(await useItineraryStore.getState().updateMemory(MEMORY, { note: "Nuevo", rating: null })).toEqual({});
    expect(writes()).toHaveLength(1);
    expect(writes()[0].table).toBe("memories");
    expect(op(writes()[0], "update")).toEqual([{ note: "Nuevo", rating: null }]);
    expect(op(writes()[0], "eq")).toEqual(["id", MEMORY]);
    expect(useItineraryStore.getState().activeTrip?.memories?.[0]).toMatchObject({ note: "Nuevo", rating: null });
  });

  it("deletes the photo objects, then the memory row (photos and audience cascade)", async () => {
    useItineraryStore.setState({ activeTrip: plan({ memories: [memory()] }) } as never);
    expect(await useItineraryStore.getState().deleteMemory(MEMORY)).toEqual({});
    expect(db.storage).toEqual([{ kind: "remove", bucket: "trip-memories", args: [[`${TRIP}/${MEMORY}/a.webp`, `${TRIP}/${MEMORY}/b.webp`]] }]);
    expect(writes().map((c) => [c.table, c.kind])).toEqual([["memories", "delete"]]);
    expect(op(writes()[0], "eq")).toEqual(["id", MEMORY]);
    expect(useItineraryStore.getState().activeTrip?.memories).toEqual([]);
  });

  it("removes one photo row and then its object", async () => {
    useItineraryStore.setState({ activeTrip: plan({ memories: [memory()] }) } as never);
    expect(await useItineraryStore.getState().removeMemoryPhoto(MEMORY, "p1")).toEqual({});
    expect(writes().map((c) => [c.table, c.kind, op(c, "eq")])).toEqual([["memory_photos", "delete", ["id", "p1"]]]);
    expect(db.storage).toEqual([{ kind: "remove", bucket: "trip-memories", args: [[`${TRIP}/${MEMORY}/a.webp`]] }]);
    expect(useItineraryStore.getState().activeTrip?.memories?.[0]?.photos.map((p) => p.id)).toEqual(["p2"]);
  });

  it("adds photos after the existing ones", async () => {
    useItineraryStore.setState({ activeTrip: plan({ memories: [memory()] }) } as never);
    const result = await useItineraryStore.getState().addMemoryPhotos(MEMORY, [image()]);
    expect(result).toEqual({ failedPhotos: [] });
    const row = (op(writes()[0], "insert")?.[0] as Record<string, unknown>[])[0];
    expect(row).toMatchObject({ memory_id: MEMORY, trip_id: TRIP, sort_order: 2 });
    expect(useItineraryStore.getState().activeTrip?.memories?.[0]?.photos).toHaveLength(3);
  });

  it("narrows the audience: adds the new people first, then restricts the memory", async () => {
    useItineraryStore.setState({ activeTrip: plan({ memories: [memory()] }) } as never);
    expect(await useItineraryStore.getState().setMemoryAudience(MEMORY, "selected", ["u2"])).toEqual({});
    expect(writes().map((c) => [c.table, c.kind])).toEqual([["memory_audience", "upsert"], ["memories", "update"]]);
    expect(op(writes()[0], "upsert")?.[1]).toMatchObject({ onConflict: "memory_id,user_id", ignoreDuplicates: true });
    expect(op(writes()[1], "update")).toEqual([{ audience: "selected" }]);
    expect(useItineraryStore.getState().activeTrip?.memories?.[0]).toMatchObject({ audience: "selected", audienceUserIds: ["u2"] });
    expect(window.localStorage.getItem(`plania_memory_audience_${TRIP}`)).toBe("selected");
  });

  it("always sends the audience, even when this device thinks it is unchanged", async () => {
    useItineraryStore.setState({ activeTrip: plan({ memories: [memory({ audience: "selected", audienceUserIds: ["u2"] })] }) } as never);
    expect(await useItineraryStore.getState().setMemoryAudience(MEMORY, "selected", ["u2", "u3"])).toEqual({});
    expect(writes().map((c) => [c.table, c.kind])).toEqual([["memory_audience", "upsert"], ["memories", "update"]]);
    expect(op(writes()[1], "update")).toEqual([{ audience: "selected" }]);
  });

  it("widens the audience to the whole trip and then drops the old rows", async () => {
    useItineraryStore.setState({ activeTrip: plan({ memories: [memory({ audience: "selected", audienceUserIds: ["u2", "u3"] })] }) } as never);
    expect(await useItineraryStore.getState().setMemoryAudience(MEMORY, "trip", [])).toEqual({});
    expect(writes().map((c) => [c.table, c.kind])).toEqual([["memories", "update"], ["memory_audience", "delete"]]);
    expect(op(writes()[1], "eq")).toEqual(["memory_id", MEMORY]);
    expect(op(writes()[1], "in")).toEqual(["user_id", ["u2", "u3"]]);
  });

  it("forbids changing someone else's memory without any request", async () => {
    useItineraryStore.setState({ activeTrip: plan({ memories: [memory({ authorId: "u2" })] }) } as never);
    const store = useItineraryStore.getState();
    expect(await store.updateMemory(MEMORY, { note: "x" })).toEqual({ error: "forbidden" });
    expect(await store.deleteMemory(MEMORY)).toEqual({ error: "forbidden" });
    expect(await store.setMemoryAudience(MEMORY, "trip", [])).toEqual({ error: "forbidden" });
    expect(await store.removeMemoryPhoto(MEMORY, "p1")).toEqual({ error: "forbidden" });
    expect(db.calls).toEqual([]);
    expect(db.storage).toEqual([]);
  });
});

describe("drafts and offline", () => {
  it("returns draft or offline without any network call", async () => {
    useItineraryStore.setState({ activeTrip: plan({ memories: [memory()] }), activeTripIsDraft: true } as never);
    const store = () => useItineraryStore.getState();
    expect(await store().createMemory({ audience: "trip" })).toEqual({ error: "draft" });
    expect(await store().deleteMemory(MEMORY)).toEqual({ error: "draft" });
    expect(await store().loadTripMembers(TRIP)).toEqual({ members: [], error: "draft" });

    useItineraryStore.setState({ activeTripIsDraft: false } as never);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    expect(await store().createMemory({ audience: "trip" })).toEqual({ error: "offline" });
    expect(await store().updateMemory(MEMORY, { note: "x" })).toEqual({ error: "offline" });
    expect(await store().deleteMemory(MEMORY)).toEqual({ error: "offline" });
    expect(await store().addMemoryPhotos(MEMORY, [image()])).toEqual({ error: "offline" });
    expect(await store().removeMemoryPhoto(MEMORY, "p1")).toEqual({ error: "offline" });
    expect(await store().setMemoryAudience(MEMORY, "trip", [])).toEqual({ error: "offline" });
    expect(await store().loadTripMembers(TRIP)).toEqual({ members: [], error: "offline" });
    expect(db.calls).toEqual([]);
    expect(db.storage).toEqual([]);
    expect(db.rpc).toEqual([]);
  });
});

describe("loadTripMembers", () => {
  it("lists the trip members through trip_members", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    db.results["rpc"] = { data: [{ user_id: "u1", email: "me@example.com", is_owner: true }], error: null };
    expect(await useItineraryStore.getState().loadTripMembers(TRIP)).toEqual({ members: [{ userId: "u1", email: "me@example.com", isOwner: true }] });
    expect(db.rpc).toEqual([["trip_members", { p_trip_id: TRIP }]]);
  });
});

describe("setTripCover compression", () => {
  it("uploads the compressed image after validating the original", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    const original = image("cover.jpg");
    expect(await useItineraryStore.getState().setTripCover(original)).toEqual({});
    expect(compressImage).toHaveBeenCalledWith(original);
    const upload = db.storage.find((s) => s.kind === "upload");
    expect(upload?.bucket).toBe("trip-covers");
    expect(upload?.args[0]).toMatch(new RegExp(`^${TRIP}/${UUID}\.webp$`));
    expect((upload?.args[1] as File).type).toBe("image/webp");
    expect(upload?.args[2]).toMatchObject({ contentType: "image/webp" });
  });
});
