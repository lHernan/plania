import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SHA, FLIGHT_DOC } from "./fixtures/bookings/documents";

// S1-S3 (odd/tasks/ai-rate-limits.md): every AI route counts one request against the caller's
// daily quota right before the AI call, with the caller's own client, and answers 429 when over.
vi.mock("@/lib/ai/provider", () => ({ LONG_REPLY_TIMEOUT_MS: 60_000, runAiPrompt: vi.fn(), runAiVisionPages: vi.fn() }));
const detectCodeRegions = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/services/gemini-service", () => ({ geminiService: { detectCodeRegions } }));
vi.mock("@/lib/weather/day-forecast", () => ({ fetchDayWeather: vi.fn(async () => ({ hours: [], days: [] })) }));

type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { code?: string; message?: string } | null; status?: number };

const db = vi.hoisted(() => ({
  user: { id: "me" } as { id: string; is_anonymous?: boolean } | null,
  tables: {} as Record<string, Row[]>,
  quota: { data: [{ allowed: true, used: 1, remaining: 9 }], error: null } as RpcResult,
  authClients: [] as unknown[],
  rpc: [] as Array<{ client: unknown; fn: string; args: unknown }>,
  adminInserts: [] as string[],
}));

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  const rows = () => (db.tables[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    in: () => builder,
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return builder;
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return builder;
}

vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => {
    const client: Record<string, unknown> = {
      auth: { getUser: async () => ({ data: { user: db.user }, error: db.user ? null : { message: "no session" } }) },
      from: (table: string) => query(table),
    };
    client.rpc = async (fn: string, args: unknown) => {
      db.rpc.push({ client, fn, args });
      return db.quota;
    };
    db.authClients.push(client);
    return client;
  },
  getServiceRoleSupabase: () => ({
    // The chat's existing short-term throttle always lets these requests through.
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => ({
      insert: () => {
        db.adminInserts.push(table);
        return { select: () => ({ single: async () => ({ data: null, error: { message: "not in this test" } }) }), then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      },
    }),
  }),
}));

const provider = await import("@/lib/ai/provider");
const runAiPrompt = vi.mocked(provider.runAiPrompt);
const runAiVisionPages = vi.mocked(provider.runAiVisionPages);
const quota = await import("@/lib/ai/quota");
const chat = await import("@/app/api/chat/route");
const importRoute = await import("@/app/api/import/route");
const extract = await import("@/app/api/bookings/extract/route");
const detectCodes = await import("@/app/api/detect-codes/route");
const packing = await import("@/app/api/packing-list/route");
const dayGenius = await import("@/app/api/day-genius/route");
const summary = await import("@/app/api/trips/[tripId]/summary/route");
const caption = await import("@/app/api/memories/caption/route");

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify(body) });

const geniusContext = {
  date: "2026-11-02",
  city: "La Palma",
  mode: "today",
  now: "12:20",
  windowStart: "12:20",
  dayEnd: "22:00",
  fixed: [{ id: "car", title: "Car drop-off", kind: "booking", start: "18:30", end: "19:30" }],
  movable: [{ id: "lunch", title: "Almuerzo", category: "food", priority: "medium", location: "Los Llanos", time: "14:00", durationMin: 60, status: "upcoming" }],
  travel: [],
  otherDays: [],
};
const planning = {
  context: { tripName: "x", density: "balanced", days: [{ date: "2026-11-02", city: "c", anchors: [], freeWindows: [], maxSuggestions: 1 }] },
};

type RouteCase = {
  name: string;
  bucket: keyof typeof quota.AI_QUOTA_LIMITS;
  call: () => Promise<Response>;
  invalid: () => Promise<Response>;
  ai: () => ReturnType<typeof vi.fn>;
};

const cases: RouteCase[] = [
  {
    name: "chat",
    bucket: "chat",
    call: () => chat.POST(post("http://localhost/api/chat", { tripId: "t1", content: "hola", lang: "es" })),
    invalid: () => chat.POST(post("http://localhost/api/chat", { tripId: "t1", content: "  " })),
    ai: () => runAiPrompt,
  },
  {
    name: "text import",
    bucket: "import",
    call: () => importRoute.POST(post("http://localhost/api/import", { text: "Lunch", fallbackDate: "2026-11-02", lang: "es" })),
    invalid: () => importRoute.POST(post("http://localhost/api/import", { fallbackDate: "2026-11-02" })),
    ai: () => runAiPrompt,
  },
  {
    name: "planning",
    bucket: "import",
    call: () => importRoute.POST(post("http://localhost/api/import", { lang: "es", planning })),
    invalid: () => importRoute.POST(post("http://localhost/api/import", { lang: "es", planning: { context: "nope" } })),
    ai: () => runAiPrompt,
  },
  {
    name: "booking extraction",
    bucket: "bookings",
    call: () => extract.POST(post("http://localhost/api/bookings/extract", { fileName: "f.pdf", sha256: FAKE_SHA, pages: [{ index: 0, text: FLIGHT_DOC }] })),
    invalid: () => extract.POST(post("http://localhost/api/bookings/extract", { fileName: "f.pdf", sha256: "bad", pages: [] })),
    ai: () => runAiPrompt,
  },
  {
    name: "code detection",
    bucket: "bookings",
    call: () => detectCodes.POST(post("http://localhost/api/detect-codes", { imageUri: "data:image/jpeg;base64,x" }) as never),
    invalid: () => detectCodes.POST(post("http://localhost/api/detect-codes", {}) as never),
    ai: () => detectCodeRegions,
  },
  {
    name: "packing list",
    bucket: "packing",
    call: () => packing.POST(post("http://localhost/api/packing-list", { cities: ["Roma"], weatherSummaries: [], activityBreakdown: {}, luggageDescription: "", durationDays: 3, travelerCount: 1, lang: "es" })),
    invalid: () => packing.POST(new Request("http://localhost/api/packing-list", { method: "POST", headers: { Authorization: "Bearer t" }, body: "{not json" })),
    ai: () => runAiPrompt,
  },
  {
    name: "day genius",
    bucket: "day_genius",
    call: () => dayGenius.POST(post("http://localhost/api/day-genius", { context: geniusContext, today: "2026-11-02", lang: "es" })),
    invalid: () => dayGenius.POST(post("http://localhost/api/day-genius", { context: {}, lang: "es" })),
    ai: () => runAiPrompt,
  },
  {
    name: "trip summary",
    bucket: "summary",
    call: () => summary.POST(post("http://localhost/api/trips/t1/summary", { lang: "es" }), { params: Promise.resolve({ tripId: "t1" }) }),
    invalid: () => summary.POST(post("http://localhost/api/trips/nope/summary", { lang: "es" }), { params: Promise.resolve({ tripId: "nope" }) }),
    ai: () => runAiPrompt,
  },
  {
    name: "memory caption",
    bucket: "caption",
    call: () => caption.POST(post("http://localhost/api/memories/caption", { tripId: "t1", activityTitle: "Museo", lang: "es" })),
    invalid: () => caption.POST(post("http://localhost/api/memories/caption", { lang: "es" })),
    ai: () => runAiPrompt,
  },
];

const quotaCalls = () => db.rpc.filter((call) => call.fn === "consume_ai_quota");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T22:00:00Z"));
  db.user = { id: "me" };
  db.tables = {
    trips: [{ id: "t1", name: "La Palma", user_id: "me", start_date: "2026-11-02", end_date: "2026-11-03", travel_context: null }],
  };
  db.quota = { data: [{ allowed: true, used: 1, remaining: 9 }], error: null };
  db.authClients = [];
  db.rpc = [];
  db.adminInserts = [];
  runAiPrompt.mockReset();
  runAiPrompt.mockResolvedValue("{}");
  runAiVisionPages.mockReset();
  detectCodeRegions.mockClear();
  quota.resetAiQuotaWarningsForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AI routes enforce the daily quota", () => {
  it.each(cases)("$name: 429 ai_quota_exceeded with Retry-After, without calling the AI", async ({ bucket, call, ai }) => {
    db.quota = { data: [{ allowed: false, used: quota.AI_QUOTA_LIMITS[bucket], remaining: 0 }], error: null };
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "ai_quota_exceeded", bucket, limit: quota.AI_QUOTA_LIMITS[bucket] });
    // 22:00 UTC: two hours until the quotas reset at midnight UTC.
    expect(res.headers.get("Retry-After")).toBe("7200");
    expect(ai()).not.toHaveBeenCalled();
  });

  it.each(cases)("$name: counts against \"$bucket\" with the caller's own auth client, then calls the AI", async ({ bucket, call, ai }) => {
    await call();
    expect(quotaCalls()).toHaveLength(1);
    expect(quotaCalls()[0].args).toEqual({ p_bucket: bucket });
    expect(db.authClients).toContain(quotaCalls()[0].client);
    expect(ai()).toHaveBeenCalledTimes(1);
  });

  it.each(cases)("$name: an invalid request does not consume quota", async ({ invalid, ai }) => {
    const res = await invalid();
    // Each route keeps its own error (the packing list answers bad JSON with 502, as before).
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(429);
    expect(quotaCalls()).toHaveLength(0);
    expect(ai()).not.toHaveBeenCalled();
  });

  it.each(cases)("$name: an anonymous guest gets 401 without consuming quota", async ({ call, ai }) => {
    db.user = { id: "anon", is_anonymous: true };
    const res = await call();
    expect(res.status).toBe(401);
    expect(quotaCalls()).toHaveLength(0);
    expect(ai()).not.toHaveBeenCalled();
  });

  it("chat: over the quota the user message is not stored", async () => {
    db.quota = { data: [{ allowed: false, used: 100, remaining: 0 }], error: null };
    await cases[0].call();
    expect(db.adminInserts).toEqual([]);
  });

  it("migration not applied (function missing): fails open and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.quota = { data: null, error: { code: "PGRST202", message: "Could not find the function" }, status: 404 };
    await cases[5].call();
    await cases[5].call();
    expect(runAiPrompt).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("any other quota error fails closed with 503 and never calls the AI", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.quota = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" }, status: 500 };
    const res = await cases[5].call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ai_quota_unavailable" });
    expect(runAiPrompt).not.toHaveBeenCalled();
  });
});

describe("secondsUntilUtcMidnight", () => {
  it("counts down to the next 00:00 UTC", () => {
    expect(quota.secondsUntilUtcMidnight(new Date("2026-11-06T23:59:30Z"))).toBe(30);
    expect(quota.secondsUntilUtcMidnight(new Date("2026-11-06T00:00:00Z"))).toBe(86_400);
  });
});
