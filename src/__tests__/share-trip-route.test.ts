import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// An in-memory stand-in for the service-role client: filters are applied for real, so a query
// that forgets a filter leaks rows in these tests the same way it would in the database.
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  signed: [] as string[],
  serviceClients: 0,
  anonClients: 0,
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
      eq: (column: string, value: unknown) => ((result = result.filter((r) => r[column] === value)), builder),
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
// What the public page shows of a day and an activity; every other column stays private.
const PUBLIC_DAY = { id: "d1", date: "2026-11-05", city: "Funchal", label: "Day 1" };
const PUBLIC_ACT = { id: "a1", day_id: "d1", title: "Levada", time: "09:00", state: "completed" };
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

describe("GET /api/share/[token]/trip", () => {
  it("returns only what the public page shows for a valid token of a trip without public memories or cover", async () => {
    const res = await call(getTrip);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      trip: { id: "t1", name: "La Palma", startDate: "2026-11-05", endDate: "2026-11-06" },
      role: "viewer",
      days: [PUBLIC_DAY],
      activities: [PUBLIC_ACT],
    });
  });

  it("never sends private columns of days and activities, nor the reservations", async () => {
    db.tables.trip_days = [{ ...DAY, user_id: "u-owner", notes: "door code 1234" }];
    db.tables.activities = [
      { ...ACT, user_id: "u-owner", notes: "PIN 4321", booking: { confirmation: "ABC123" }, expected_cost: 20, actual_cost: 25, duration_min: 90, location: "Rabaçal", category: "nature" },
    ];
    db.tables.critical_reservations = [{ id: "r1", trip_id: "t1", title: "Hotel", confirmation_code: "XYZ789" }];
    const body = await (await call(getTrip)).json();
    expect(body.days).toEqual([PUBLIC_DAY]);
    expect(body.activities).toEqual([{ ...PUBLIC_ACT, duration_min: 90, location: "Rabaçal", category: "nature" }]);
    expect(body).not.toHaveProperty("reservations");
    const text = JSON.stringify(body);
    for (const secret of ["u-owner", "1234", "4321", "ABC123", "XYZ789"]) expect(text).not.toContain(secret);
  });

  it.each([
    ["an unknown token", () => (db.tables.trip_share_links = []), 404],
    ["a revoked link", () => (db.tables.trip_share_links = [{ ...LINK, revoked_at: "2026-01-01T00:00:00Z" }]), 410],
    ["an expired link", () => (db.tables.trip_share_links = [{ ...LINK, expires_at: "2020-01-01T00:00:00Z" }]), 410],
  ])("refuses %s and reads nothing else", async (_label, arrange, status) => {
    arrange();
    const res = await call(getTrip);
    expect(res.status).toBe(status);
    expect(await res.json()).not.toHaveProperty("trip");
    expect(db.signed).toEqual([]);
  });

  it("never falls back to the anon key: without the service role key it refuses", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_x");
    const res = await call(getTrip);
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("trip");
    expect(db.serviceClients).toBe(0);
    expect(db.anonClients).toBe(0);
  });

  it("includes only the trip's memories shared with the whole trip, with signed photo URLs", async () => {
    addMemories();
    const body = await (await call(getTrip)).json();
    expect(body.memories).toEqual([
      {
        id: "m-trip",
        activityId: "a1",
        note: "Precioso",
        rating: 5,
        createdAt: "2026-11-05T10:00:00Z",
        photos: [{ id: "p1", url: `https://signed/trip-memories/${PHOTO_PATH}`, caption: "Cascada" }],
      },
    ]);
  });

  it("never signs or exposes photos of memories shared with some people or of other trips", async () => {
    addMemories();
    const text = JSON.stringify(await (await call(getTrip)).json());
    expect(db.signed).toEqual([`trip-memories:${PHOTO_PATH}`]);
    expect(text).not.toContain("Solo nosotros");
    expect(text).not.toContain("Otro viaje");
    expect(text).not.toContain(SELECTED_PATH);
    expect(text).not.toContain(OTHER_TRIP_PATH);
  });

  it("never signs a photo whose path is outside its memory's folder", async () => {
    addMemories();
    db.tables.memory_photos = [{ id: "p9", memory_id: "m-trip", trip_id: "t1", path: SELECTED_PATH, caption: null, sort_order: 0 }];
    const body = await (await call(getTrip)).json();
    expect(db.signed).toEqual([]);
    expect(body.memories[0].photos).toEqual([]);
  });

  it("has no author ids, emails, audience or storage paths in the payload", async () => {
    addMemories();
    const text = JSON.stringify(await (await call(getTrip)).json());
    expect(text).not.toContain("u-secret-author");
    expect(text).not.toMatch(/author|audience|email|"path"/i);
  });

  it("includes a signed cover URL when the trip has a cover", async () => {
    db.tables.trips = [{ ...TRIP, cover_path: "t1/cover.webp" }];
    const body = await (await call(getTrip)).json();
    expect(body.trip.coverUrl).toBe("https://signed/trip-covers/t1/cover.webp");
    expect(db.signed).toEqual(["trip-covers:t1/cover.webp"]);
  });
});

describe("GET /api/share/[token]", () => {
  it("returns the link summary without the owner id, the invited email or when it was accepted", async () => {
    db.tables.trip_share_links = [{ ...LINK, email: "friend@x.io", accepted_by: "u-friend", accepted_at: "2026-11-01T00:00:00Z" }];
    const body = await (await call(getInfo)).json();
    expect(body).toEqual({ tripId: "t1", tripName: "La Palma", startDate: "2026-11-05", endDate: "2026-11-06", role: "viewer", accepted: true });
    const text = JSON.stringify(body);
    for (const secret of ["u-owner", "friend@x.io", "u-friend"]) expect(text).not.toContain(secret);
  });

  it("refuses unknown, revoked and expired links", async () => {
    db.tables.trip_share_links = [];
    expect((await call(getInfo)).status).toBe(404);
    db.tables.trip_share_links = [{ ...LINK, revoked_at: "2026-01-01T00:00:00Z" }];
    expect((await call(getInfo)).status).toBe(410);
    db.tables.trip_share_links = [{ ...LINK, expires_at: "2020-01-01T00:00:00Z" }];
    expect((await call(getInfo)).status).toBe(410);
  });

  it("never falls back to the anon key", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "anon-key");
    expect((await call(getInfo)).status).toBe(500);
    expect(db.serviceClients).toBe(0);
    expect(db.anonClients).toBe(0);
  });
});
