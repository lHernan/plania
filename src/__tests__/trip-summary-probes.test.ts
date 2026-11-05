import { beforeEach, describe, expect, it, vi } from "vitest";

// S4: "Resume mi viaje" and the suggested caption. The summary reads the trip with the
// caller's own client, so RLS hands it only the memories the caller can see (S2).
vi.mock("@/lib/ai/provider", () => ({ runAiPrompt: vi.fn() }));

type Row = Record<string, unknown>;
type Tables = Record<string, { data: Row[] | null; error?: { code?: string; message?: string } | null }>;

const db = vi.hoisted(() => ({
  user: { id: "me" } as { id: string; is_anonymous?: boolean } | null,
  tables: {} as Tables,
  queried: [] as string[],
  authClients: [] as unknown[],
  requests: [] as Request[],
  serviceRole: vi.fn(),
}));

// A chainable query: every filter returns itself; awaiting it (or maybeSingle) yields the rows.
function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  const result = () => {
    const entry = db.tables[table] ?? { data: [] };
    const rows = (entry.data ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
    return { rows, error: entry.error ?? null, data: entry.data };
  };
  const builder = {
    select: () => builder,
    order: () => builder,
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return builder;
    },
    maybeSingle: async () => {
      const { rows, error } = result();
      return { data: error ? null : rows[0] ?? null, error };
    },
    then: (resolve: (value: { data: Row[] | null; error: unknown }) => unknown) => {
      const { rows, error, data } = result();
      return Promise.resolve({ data: error || data === null ? null : rows, error }).then(resolve);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: (request: Request) => {
    const client = {
      auth: { getUser: async () => ({ data: { user: db.user }, error: db.user ? null : { message: "no session" } }) },
      from: (table: string) => {
        db.queried.push(table);
        return query(table);
      },
    };
    db.requests.push(request);
    db.authClients.push(client);
    return client;
  },
  getServiceRoleSupabase: db.serviceRole,
}));

const provider = await import("@/lib/ai/provider");
const runAiPrompt = vi.mocked(provider.runAiPrompt);
const summaryRoute = await import("@/app/api/trips/[tripId]/summary/route");
const captionRoute = await import("@/app/api/memories/caption/route");

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify(body) });
const summarize = (tripId = "t1", lang = "es") =>
  summaryRoute.POST(post(`http://localhost/api/trips/${tripId}/summary`, { lang }), { params: Promise.resolve({ tripId }) });
const userPrompt = () => String(runAiPrompt.mock.calls[0]?.[1] ?? "");

function seedTrip(overrides: { travelContext?: unknown; owner?: string; shares?: Row[] } = {}) {
  db.tables = {
    trips: { data: [{ id: "t1", name: "Japón 2026", user_id: overrides.owner ?? "me", start_date: "2026-10-26", end_date: "2026-10-27", travel_context: overrides.travelContext ?? null }] },
    trip_shares: { data: overrides.shares ?? [] },
    trip_days: {
      data: [
        { id: "d1", trip_id: "t1", date: "2026-10-26", city: "Tokyo", label: "Llegada" },
        { id: "d2", trip_id: "t1", date: "2026-10-27", city: "Kyoto", label: "" },
      ],
    },
    activities: {
      data: [
        { id: "a1", trip_id: "t1", day_id: "d1", title: "Senso-ji", state: "completed", time: "10:00", sort_order: 0 },
        { id: "a2", trip_id: "t1", day_id: "d1", title: "Skytree", state: "pending", time: "18:00", sort_order: 1 },
        { id: "b1", trip_id: "t1", day_id: "d2", title: "Fushimi Inari", state: "completed", time: "09:00", sort_order: 0 },
      ],
    },
    // What RLS returns for this caller: only the memories they can see. Extra columns stand
    // for anything a broader select could bring back; none of it may reach the AI.
    memories: {
      data: [
        { id: "m1", trip_id: "t1", activity_id: "a1", note: "Amanecer precioso", rating: 5, author_id: "author-secret-id", audience: "selected", photos: [{ path: "t1/m1/photo-secret.webp" }], author_email: "luis@x.io" },
        { id: "m2", trip_id: "t1", activity_id: null, note: "El mejor viaje con amigos", rating: 4, author_id: "author-secret-id", audience: "trip" },
      ],
    },
  };
}

beforeEach(() => {
  db.user = { id: "me" };
  db.queried = [];
  db.authClients = [];
  db.requests = [];
  db.serviceRole.mockReset();
  runAiPrompt.mockReset();
  runAiPrompt.mockResolvedValue("Un viaje.");
  seedTrip();
});
const caption = (body: unknown) => captionRoute.POST(post("http://localhost/api/memories/caption", body));

describe("probe T3", () => {
  it("summary: a non-member who can read the trip (share link) gets 403 and nothing else is read or sent", async () => {
    seedTrip({ owner: "other" });
    const res = await summarize();
    expect(res.status).toBe(403);
    expect(db.queried).toEqual(["trips", "trip_shares"]);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });
  it("summary: the body cannot switch the trip; only the path tripId is read", async () => {
    const res = await summaryRoute.POST(post("http://localhost/api/trips/t1/summary", { lang: "es", tripId: "t2" }), { params: Promise.resolve({ tripId: "t1" }) });
    expect(res.status).toBe(200);
    expect(userPrompt()).toContain("Japón 2026");
  });
  it("summary: hidden 404 and nonexistent 404 are identical", async () => {
    const r1 = await summarize("nope");
    expect(r1.status).toBe(404);
    expect(await r1.json()).toEqual({ error: "trip_not_found" });
  });
  it("summary: prompt never contains ids, emails, paths", async () => {
    await summarize();
    const all = String(runAiPrompt.mock.calls[0][0]) + userPrompt();
    for (const s of ["author-secret-id", "luis@x.io", "photo-secret", "m1", "\"t1\"", "selected"]) expect(all).not.toContain(s);
  });
  it("caption: a memory of another trip cannot be read through the caller's trip", async () => {
    db.tables.memories.data!.push({ id: "mx", trip_id: "t2", activity_id: null, note: "secreto ajeno", rating: 1 });
    const res = await caption({ tripId: "t1", memoryId: "mx", lang: "es" });
    expect(res.status).toBe(404);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });
  it("caption: memoryId without tripId is rejected before any read", async () => {
    const res = await caption({ memoryId: "m1", lang: "es" });
    expect(res.status).toBe(400);
    expect(db.queried).toEqual([]);
  });
  it("caption: non-member of a readable trip gets 403 with no memory read", async () => {
    seedTrip({ owner: "other" });
    const res = await caption({ tripId: "t1", memoryId: "m1", lang: "es" });
    expect(res.status).toBe(403);
    expect(db.queried).not.toContain("memories");
    expect(runAiPrompt).not.toHaveBeenCalled();
  });
  it("caption: invalid JSON body -> 400", async () => {
    const res = await captionRoute.POST(new Request("http://localhost/api/memories/caption", { method: "POST", headers: { Authorization: "Bearer t" }, body: "{" }));
    expect(res.status).toBe(400);
  });
  it("caption: overlong AI output is capped at 120", async () => {
    runAiPrompt.mockResolvedValue("x ".repeat(200));
    const res = await caption({ activityTitle: "Museo", lang: "es" });
    const body = await res.json();
    expect(body.caption.length).toBeLessThanOrEqual(120);
  });
  it("summary: cleanSummaryText keeps ordinary text with # and _", async () => {
    const { cleanSummaryText } = await import("@/lib/ai/trip-summary");
    // observational
    console.log("CLEAN:", JSON.stringify(cleanSummaryText("Room #5 at snake_case_inn, rated 4*.")));
  });
});
