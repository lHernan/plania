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
      // Daily AI quota (consume_ai_quota): always allowed here.
      rpc: async () => ({ data: [{ allowed: true, used: 1, remaining: 9 }], error: null }),
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
  runAiPrompt.mockResolvedValue("Un viaje inolvidable por Japón.");
  seedTrip();
});

describe("POST /api/trips/[tripId]/summary", () => {
  it("reads the trip and its memories with the caller's own client, never a service-role client", async () => {
    const res = await summarize();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: "Un viaje inolvidable por Japón." });
    expect(db.authClients).toHaveLength(1);
    expect(db.requests[0].headers.get("Authorization")).toBe("Bearer t");
    expect(db.queried).toEqual(expect.arrayContaining(["trips", "trip_days", "activities", "memories"]));
    expect(db.serviceRole).not.toHaveBeenCalled();
  });

  it("sends the trip name, cities, completed activities and the visible memories", async () => {
    await summarize();
    const prompt = userPrompt();
    expect(prompt).toContain("Japón 2026");
    expect(prompt).toContain("Tokyo");
    expect(prompt).toContain("Kyoto");
    expect(prompt).toContain("Senso-ji");
    expect(prompt).toContain("Fushimi Inari");
    expect(prompt).not.toContain("Skytree");
    expect(prompt).toContain("Amanecer precioso");
    expect(prompt).toContain("El mejor viaje con amigos");
  });

  it("only the memories RLS returns reach the prompt", async () => {
    db.tables.memories = { data: [{ id: "m2", trip_id: "t1", activity_id: null, note: "Solo esta", rating: null }] };
    await summarize();
    expect(userPrompt()).toContain("Solo esta");
    expect(userPrompt()).not.toContain("Amanecer precioso");
  });

  it("never sends photos, emails or author ids", async () => {
    await summarize();
    const sent = JSON.stringify(runAiPrompt.mock.calls[0]);
    expect(sent).not.toContain("author-secret-id");
    expect(sent).not.toContain("photo-secret");
    expect(sent).not.toContain("luis@x.io");
    expect(sent).not.toContain("selected");
  });

  it("names the days of an undated trip by number and sends no placeholder dates", async () => {
    seedTrip({ travelContext: { undated: true } });
    await summarize();
    const prompt = userPrompt();
    expect(prompt).toContain("Día 1");
    expect(prompt).toContain("Día 2");
    expect(prompt).not.toContain("2026-10-26");
    expect(prompt).not.toContain("2026-10-27");
  });

  it("dated trips send their dates", async () => {
    await summarize("t1", "en");
    expect(userPrompt()).toContain("2026-10-26");
    expect(String(runAiPrompt.mock.calls[0][0])).toMatch(/English/);
  });

  it("404 when the caller cannot read the trip", async () => {
    db.tables.trips = { data: [] };
    const res = await summarize();
    expect(res.status).toBe(404);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("403 when the trip is readable but the caller is neither its owner nor a member", async () => {
    seedTrip({ owner: "someone-else" });
    const res = await summarize();
    expect(res.status).toBe(403);
    expect(runAiPrompt).not.toHaveBeenCalled();
    expect(db.queried).not.toContain("memories");
  });

  it("answers a member the trip is shared with", async () => {
    seedTrip({ owner: "someone-else", shares: [{ trip_id: "t1", shared_with: "me" }] });
    const res = await summarize();
    expect(res.status).toBe(200);
  });

  it("503 when the AI is unavailable", async () => {
    runAiPrompt.mockRejectedValue(new Error("AI Provider error"));
    const res = await summarize();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai_unavailable" });
  });

  it("returns plain text without markdown", async () => {
    runAiPrompt.mockResolvedValue("## Tu viaje\n\n**Japón** fue *genial*.\n\n- Templos\n- Comida");
    const { summary } = await (await summarize()).json();
    expect(summary).not.toMatch(/[#*]/);
    expect(summary).not.toMatch(/^- /m);
    expect(summary).toContain("Japón fue genial.");
  });

  it("keeps symbols that are part of ordinary prose", async () => {
    runAiPrompt.mockResolvedValue("Room #5 at snake_case_inn, rated 4*. A *great* stay.");
    const { summary } = await (await summarize()).json();
    expect(summary).toBe("Room #5 at snake_case_inn, rated 4*. A great stay.");
  });

  it("works when the memories table does not exist yet", async () => {
    db.tables.memories = { data: null, error: { code: "42P01", message: "relation memories does not exist" } };
    const res = await summarize();
    expect(res.status).toBe(200);
    expect(userPrompt()).toContain("Senso-ji");
  });
});

describe("POST /api/memories/caption", () => {
  const caption = (body: Record<string, unknown>) => captionRoute.POST(post("http://localhost/api/memories/caption", { lang: "es", ...body }));

  it("suggests a caption of at most 120 characters from text only", async () => {
    runAiPrompt.mockResolvedValue(`"${"Atardecer dorado sobre los templos de Kioto ".repeat(6)}"`);
    const res = await caption({ activityTitle: "Fushimi Inari", city: "Kyoto" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.caption.length).toBeLessThanOrEqual(120);
    expect(body.caption).not.toMatch(/^"|"$/);
    expect(userPrompt()).toContain("Fushimi Inari");
    expect(JSON.stringify(runAiPrompt.mock.calls[0])).not.toMatch(/data:image|image_url/);
  });

  it("verifies the caller can read the trip when a tripId is given", async () => {
    db.tables.trips = { data: [] };
    const res = await caption({ tripId: "t1", activityTitle: "Fushimi Inari" });
    expect(res.status).toBe(404);
    expect(runAiPrompt).not.toHaveBeenCalled();
    seedTrip({ owner: "someone-else" });
    expect((await caption({ tripId: "t1", activityTitle: "Fushimi Inari" })).status).toBe(403);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("answers for a trip the caller can read", async () => {
    runAiPrompt.mockResolvedValue("Miles de toriis al amanecer");
    const res = await caption({ tripId: "t1", activityTitle: "Fushimi Inari" });
    expect(await res.json()).toEqual({ caption: "Miles de toriis al amanecer" });
    expect(db.serviceRole).not.toHaveBeenCalled();
  });

  it("uses a visible memory of the trip when a memoryId is given, and 404 when it is not visible", async () => {
    runAiPrompt.mockResolvedValue("Amanecer en Senso-ji");
    expect((await caption({ tripId: "t1", memoryId: "m1" })).status).toBe(200);
    expect(userPrompt()).toContain("Amanecer precioso");
    runAiPrompt.mockClear();
    expect((await caption({ tripId: "t1", memoryId: "hidden" })).status).toBe(404);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("400 without anything to describe", async () => {
    expect((await caption({})).status).toBe(400);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("503 when the AI is unavailable", async () => {
    runAiPrompt.mockRejectedValue(new Error("AI Provider error"));
    expect((await caption({ activityTitle: "Senso-ji" })).status).toBe(503);
  });
});
