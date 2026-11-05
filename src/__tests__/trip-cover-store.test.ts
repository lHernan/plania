// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { kind: string; args: unknown[] };
const db = vi.hoisted(() => ({
  calls: [] as Call[],
  trips: [] as Record<string, unknown>[],
  uploadError: null as { message: string } | null,
  rpcResult: { data: null as unknown, error: null as { code?: string; message: string } | null },
}));

vi.mock("@/lib/supabase", () => {
  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const q: Record<string, unknown> = {};
    for (const name of ["select", "order", "in", "is"]) q[name] = () => q;
    q.eq = (column: string, value: unknown) => (filters.push([column, value]), q);
    q.then = (resolve: (r: unknown) => void) =>
      resolve({ data: table === "trips" ? db.trips.filter((t) => filters.every(([c, v]) => t[c] === v)) : [], error: null });
    return q;
  };
  const bucket = (name: string) => ({
    upload: async (...args: unknown[]) => (db.calls.push({ kind: `upload:${name}`, args }), { data: {}, error: db.uploadError }),
    remove: async (...args: unknown[]) => (db.calls.push({ kind: `remove:${name}`, args }), { data: [], error: null }),
  });
  return {
    supabase: {
      from: (table: string) => (db.calls.push({ kind: `from:${table}`, args: [] }), query(table)),
      storage: { from: bucket },
      rpc: async (...args: unknown[]) => (db.calls.push({ kind: "rpc", args }), db.rpcResult),
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: async () => ({ data: { session: null } }),
      },
    },
  };
});

vi.mock("@/lib/offline-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-state")>()),
  loadOfflineTripCache: vi.fn(async () => null),
  saveOfflineTripCache: vi.fn(async () => {}),
}));

const { useItineraryStore } = await import("@/store/use-itinerary-store");
const { useAuthStore } = await import("@/store/use-auth-store");

const plan = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Lisboa",
  userId: "u1",
  days: [],
  criticalReservations: [],
  shoppingItems: [],
  ignoredShoppingSuggestionKeys: [],
  ...overrides,
});
const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const image = (type = "image/png", size = 1000) => new File([new Uint8Array(size)], "photo", { type });

beforeEach(() => {
  db.calls = [];
  db.trips = [];
  db.uploadError = null;
  db.rpcResult = { data: null, error: null };
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  useAuthStore.setState({ user: { id: "u1", is_anonymous: false } as never });
  useItineraryStore.setState({ activeTrip: null, activeTripIsDraft: false, trips: [], activeDayId: "" });
});

describe("reading the cover", () => {
  it("maps cover_path into the plan and the trip summaries", async () => {
    db.trips = [{ id: TRIP_ID, name: "Lisboa", user_id: "u1", cover_path: `${TRIP_ID}/a.jpg` }];
    await useItineraryStore.getState().fetchActiveTrip(TRIP_ID);
    expect(useItineraryStore.getState().activeTrip?.coverPath).toBe(`${TRIP_ID}/a.jpg`);
    expect(useItineraryStore.getState().trips[0]?.coverPath).toBe(`${TRIP_ID}/a.jpg`);

    useItineraryStore.setState({ trips: [] });
    await useItineraryStore.getState().fetchAllTrips();
    expect(useItineraryStore.getState().trips[0]?.coverPath).toBe(`${TRIP_ID}/a.jpg`);
  });

  it("reads a trip without the column (migration not applied) as having no cover", async () => {
    db.trips = [{ id: TRIP_ID, name: "Lisboa", user_id: "u1" }];
    await useItineraryStore.getState().fetchAllTrips();
    expect(useItineraryStore.getState().trips[0]?.coverPath).toBeNull();
  });
});

describe("setTripCover", () => {
  it("rejects a wrong type or a file over 5 MB without any network call", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    expect(await useItineraryStore.getState().setTripCover(image("image/gif"))).toEqual({ error: "type" });
    expect(await useItineraryStore.getState().setTripCover(image("image/jpeg", 5 * 1024 * 1024 + 1))).toEqual({ error: "size" });
    expect(db.calls).toEqual([]);
  });

  it("uploads into the trip folder of trip-covers, points the trip at it and removes the previous cover", async () => {
    useItineraryStore.setState({ activeTrip: plan({ coverPath: `${TRIP_ID}/old.jpg` }) } as never);
    db.rpcResult = { data: `${TRIP_ID}/old.jpg`, error: null };
    expect(await useItineraryStore.getState().setTripCover(image("image/webp"))).toEqual({});

    const upload = db.calls.find((c) => c.kind === "upload:trip-covers");
    const uploadedPath = upload?.args[0] as string;
    expect(uploadedPath).toMatch(new RegExp(`^${TRIP_ID}/[0-9a-f-]{36}\\.webp$`));
    expect(upload?.args[2]).toMatchObject({ contentType: "image/webp", upsert: false });
    expect(db.calls.find((c) => c.kind === "rpc")?.args).toEqual(["set_trip_cover", { p_trip_id: TRIP_ID, p_cover_path: uploadedPath }]);
    expect(db.calls.find((c) => c.kind === "remove:trip-covers")?.args).toEqual([[`${TRIP_ID}/old.jpg`]]);
    expect(db.calls.some((c) => c.kind.startsWith("from:") || c.kind === "upload:activity-files")).toBe(false);

    expect(useItineraryStore.getState().activeTrip?.coverPath).toBe(uploadedPath);
    expect(useItineraryStore.getState().trips.find((t) => t.id === TRIP_ID)?.coverPath).toBe(uploadedPath);
  });

  it("removes the uploaded object and reports unavailable when the migration is missing", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    db.rpcResult = { data: null, error: { code: "PGRST202", message: "Could not find the function public.set_trip_cover" } };
    expect(await useItineraryStore.getState().setTripCover(image())).toEqual({ error: "unavailable" });
    const uploadedPath = db.calls.find((c) => c.kind === "upload:trip-covers")?.args[0];
    expect(db.calls.find((c) => c.kind === "remove:trip-covers")?.args).toEqual([[uploadedPath]]);
    expect(useItineraryStore.getState().activeTrip?.coverPath).toBeUndefined();
  });

  it("reports a failed upload and leaves the trip as it was", async () => {
    useItineraryStore.setState({ activeTrip: plan() } as never);
    db.uploadError = { message: "Payload too large" };
    expect(await useItineraryStore.getState().setTripCover(image())).toEqual({ error: "upload" });
    expect(db.calls.some((c) => c.kind === "rpc")).toBe(false);
  });

  it("is not available for drafts, offline or viewers", async () => {
    useItineraryStore.setState({ activeTrip: plan(), activeTripIsDraft: true } as never);
    expect(await useItineraryStore.getState().setTripCover(image())).toEqual({ error: "draft" });

    useItineraryStore.setState({ activeTripIsDraft: false } as never);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    expect(await useItineraryStore.getState().setTripCover(image())).toEqual({ error: "offline" });

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    useItineraryStore.setState({ activeTrip: plan({ userId: "owner", packing: { items: [], remote: true, role: "viewer" } }) } as never);
    expect(await useItineraryStore.getState().setTripCover(image())).toEqual({ error: "forbidden" });
    expect(db.calls).toEqual([]);
  });

  it("lets an editor change the cover of someone else's trip", async () => {
    useItineraryStore.setState({ activeTrip: plan({ userId: "owner", packing: { items: [], remote: true, role: "editor" } }) } as never);
    expect(await useItineraryStore.getState().setTripCover(image())).toEqual({});
    expect(db.calls.some((c) => c.kind === "rpc")).toBe(true);
  });
});

describe("removeTripCover", () => {
  it("clears the column through set_trip_cover and deletes the object", async () => {
    useItineraryStore.setState({ activeTrip: plan({ coverPath: `${TRIP_ID}/old.jpg` }) } as never);
    db.rpcResult = { data: `${TRIP_ID}/old.jpg`, error: null };
    expect(await useItineraryStore.getState().removeTripCover()).toEqual({});
    expect(db.calls.find((c) => c.kind === "rpc")?.args).toEqual(["set_trip_cover", { p_trip_id: TRIP_ID, p_cover_path: null }]);
    expect(db.calls.find((c) => c.kind === "remove:trip-covers")?.args).toEqual([[`${TRIP_ID}/old.jpg`]]);
    expect(useItineraryStore.getState().activeTrip?.coverPath).toBeNull();
  });

  it("is not available offline", async () => {
    useItineraryStore.setState({ activeTrip: plan({ coverPath: `${TRIP_ID}/old.jpg` }) } as never);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    expect(await useItineraryStore.getState().removeTripCover()).toEqual({ error: "offline" });
    expect(db.calls).toEqual([]);
  });
});
