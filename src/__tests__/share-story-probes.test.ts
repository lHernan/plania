import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// An in-memory stand-in for the service-role client: filters are applied for real, so a query
// that forgets a filter leaks rows in these tests the same way it would in the database.
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  signed: [] as string[],
  serviceClients: 0,
  anonClients: 0, ignoreAudience: false,
}));

// The anon key must never be used to read a shared trip: a client built with it is counted.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    db.anonClients += 1;
    throw new Error("anon client");
  },
}));

vi.mock("@/lib/supabase-server", () => {
  const query = (rows: Row[]) => {
    let result = [...rows];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (db.ignoreAudience && column === "audience" ? builder : ((result = result.filter((r) => r[column] === value)), builder)),
      in: (column: string, values: unknown[]) => ((result = result.filter((r) => values.includes(r[column]))), builder),
      order: () => builder,
      maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
      single: async () => (result[0] ? { data: result[0], error: null } : { data: null, error: { message: "no rows" } }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: result, error: null }),
    };
    return builder;
  };
  const storage = {
    from: (bucket: string) => ({
      createSignedUrl: async (p: string) => (db.signed.push(`${bucket}:${p}`), { data: { signedUrl: `https://signed/${bucket}/${p}` }, error: null }),
      createSignedUrls: async (paths: string[]) => {
        db.signed.push(...paths.map((p) => `${bucket}:${p}`));
        return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${bucket}/${p}`, error: null })), error: null };
      },
    }),
  };
  return {
    getServiceRoleSupabase: () => {
      db.serviceClients += 1;
      return { from: (table: string) => query(db.tables[table] ?? []), storage };
    },
  };
});

const { GET: getTrip } = await import("@/app/api/share/[token]/trip/route");
const { GET: getInfo } = await import("@/app/api/share/[token]/route");
type Handler = (request: Request, context: { params: Promise<{ token: string }> }) => Promise<Response>;
const call = (handler: Handler, token = "tok") => handler(new Request("http://localhost/x"), { params: Promise.resolve({ token }) });

const LINK = { id: "l1", token: "tok", trip_id: "t1", role: "viewer", email: null, expires_at: null, revoked_at: null, accepted_by: null, accepted_at: null };
const TRIP = { id: "t1", name: "La Palma", start_date: "2026-11-05", end_date: "2026-11-06", user_id: "u-owner", cover_path: null };
const DAY = { id: "d1", trip_id: "t1", date: "2026-11-05", city: "Funchal", label: "Day 1" };
const ACT = { id: "a1", trip_id: "t1", day_id: "d1", title: "Levada", time: "09:00", state: "completed", sort_order: 0 };
const PHOTO_PATH = "t1/m-trip/11111111-1111-1111-1111-111111111111.webp";
const SELECTED_PATH = "t1/m-sel/22222222-2222-2222-2222-222222222222.webp";
const OTHER_TRIP_PATH = "t2/m-other/33333333-3333-3333-3333-333333333333.webp";

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  db.signed = [];
  db.serviceClients = 0;
  db.anonClients = 0;
  db.tables = {
    trip_share_links: [LINK],
    trips: [TRIP, { ...TRIP, id: "t2", name: "Other" }],
    trip_days: [DAY],
    activities: [ACT],
    critical_reservations: [],
    memories: [],
    memory_photos: [],
  };
});

const addMemories = () => {
  db.tables.memories = [
    { id: "m-trip", trip_id: "t1", activity_id: "a1", author_id: "u-secret-author", note: "Precioso", rating: 5, audience: "trip", created_at: "2026-11-05T10:00:00Z" },
    { id: "m-sel", trip_id: "t1", activity_id: "a1", author_id: "u-secret-author", note: "Solo nosotros", rating: 4, audience: "selected", created_at: "2026-11-05T11:00:00Z" },
    { id: "m-other", trip_id: "t2", activity_id: null, author_id: "u-x", note: "Otro viaje", rating: 3, audience: "trip", created_at: "2026-11-05T12:00:00Z" },
  ];
  db.tables.memory_photos = [
    { id: "p1", memory_id: "m-trip", trip_id: "t1", path: PHOTO_PATH, caption: "Cascada", sort_order: 0 },
    { id: "p2", memory_id: "m-sel", trip_id: "t1", path: SELECTED_PATH, caption: null, sort_order: 0 },
    { id: "p3", memory_id: "m-other", trip_id: "t2", path: OTHER_TRIP_PATH, caption: null, sort_order: 0 },
  ];
};

beforeEach(() => { db.ignoreAudience = false; });

describe("verifier probes T4/S5", () => {
  it("a token of trip t2 never yields t1 data or memories", async () => {
    addMemories();
    db.tables.trip_share_links = [{ ...LINK, token: "tok2", trip_id: "t2" }];
    db.tables.trip_days.push({ id: "d2", trip_id: "t2", date: "2026-12-01", city: "X", label: "D" });
    const body = await (await call(getTrip, "tok2")).json();
    expect(body.trip.id).toBe("t2");
    const text = JSON.stringify(body);
    expect(text).not.toContain("t1");
    expect(text).not.toContain("Precioso");
    expect(text).not.toContain("Solo nosotros");
    expect(body.memories.map((m: { id: string }) => m.id)).toEqual(["m-other"]);
    expect(db.signed.every((s) => s.includes(":t2/"))).toBe(true);
  });

  it("selected memories stay out even when the query filter is lost (double filter)", async () => {
    addMemories();
    db.ignoreAudience = true;
    const body = await (await call(getTrip)).json();
    expect(body.memories.map((m: { id: string }) => m.id)).toEqual(["m-trip"]);
    expect(db.signed).not.toContain(`trip-memories:${SELECTED_PATH}`);
    expect(JSON.stringify(body)).not.toContain("Solo nosotros");
  });

  it("a photo row pointing at another trip's memory is never signed", async () => {
    addMemories();
    db.tables.memory_photos.push({ id: "px", memory_id: "m-trip", trip_id: "t1", path: OTHER_TRIP_PATH, caption: null, sort_order: 1 });
    db.tables.memory_photos.push({ id: "py", memory_id: "m-trip", trip_id: "t1", path: SELECTED_PATH, caption: null, sort_order: 2 });
    await call(getTrip);
    expect(db.signed).toEqual([`trip-memories:${PHOTO_PATH}`]);
  });

  it("revoked, expired and unknown tokens return only an error and touch no data", async () => {
    addMemories();
    for (const links of [[], [{ ...LINK, revoked_at: "2026-01-01T00:00:00Z" }], [{ ...LINK, expires_at: "2020-01-01T00:00:00Z" }]]) {
      db.tables.trip_share_links = links as never;
      db.signed = [];
      const res = await call(getTrip);
      expect([404, 410]).toContain(res.status);
      const body = await res.json();
      expect(Object.keys(body)).toEqual(["error"]);
      expect(db.signed).toEqual([]);
      const info = await call(getInfo);
      expect(Object.keys(await info.json())).toEqual(["error"]);
    }
  });

  it("a cover path of another trip is never signed", async () => {
    db.tables.trips[0] = { ...TRIP, cover_path: "t2/44444444-4444-4444-4444-444444444444.webp" };
    const body = await (await call(getTrip)).json();
    expect(body.trip.coverUrl).toBeUndefined();
    expect(db.signed).toEqual([]);
  });

  it("photo signed URLs last 1 hour", async () => {
    const mod = await import("@/lib/share/public-trip");
    expect(mod.PUBLIC_SHARE_URL_SECONDS).toBe(3600);
  });
});
