import { beforeEach, describe, expect, it, vi } from "vitest";

// S3 (odd/tasks/growth-quick-wins.md): Tachi proposes itinerary changes. Only the owner and
// shared editors get validated actions back (stored on the assistant row); viewers keep a
// read-only Tachi whose replies never carry actions.
vi.mock("@/lib/ai/provider", () => ({ runAiPrompt: vi.fn() }));

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  user: { id: "owner" } as { id: string; is_anonymous?: boolean } | null,
  tables: {} as Record<string, Row[]>,
  inserted: [] as Row[],
  members: [] as Row[] | null,
}));

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let sort: { key: string; ascending: boolean } | null = null;
  const rows = () => {
    const matching = (db.tables[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
    if (!sort) return matching;
    const { key, ascending } = sort;
    return [...matching].sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1));
  };
  const builder = {
    select: () => builder,
    order: (key: string, options?: { ascending?: boolean }) => {
      sort = { key, ascending: options?.ascending ?? true };
      return builder;
    },
    limit: () => builder,
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return builder;
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return builder;
}

vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => ({
    auth: { getUser: async () => ({ data: { user: db.user }, error: db.user ? null : { message: "no session" } }) },
    from: (table: string) => query(table),
    rpc: async (fn: string) =>
      fn === "trip_members"
        ? { data: db.members, error: db.members ? null : { message: "boom" } }
        : { data: [{ allowed: true, used: 1, remaining: 9 }], error: null },
  }),
  getServiceRoleSupabase: () => ({
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => ({
      insert: (value: Row) => {
        const row = { id: `m${db.inserted.length + 1}`, created_at: "2026-11-06T10:00:00Z", ...value };
        db.inserted.push(row);
        (db.tables[table] ??= []).push(row);
        return {
          select: () => ({ single: async () => ({ data: row, error: null }) }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
        };
      },
    }),
  }),
}));

const provider = await import("@/lib/ai/provider");
const runAiPrompt = vi.mocked(provider.runAiPrompt);
const chat = await import("@/app/api/chat/route");

const post = (body: unknown) =>
  chat.POST(new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
    body: JSON.stringify(body),
  }));

const validAdd = {
  type: "add_activity",
  payload: { dayId: "d1", title: "Museo del Prado", time: "10:00", durationMin: 120, category: "sightseeing" },
};
const unknownDay = { type: "add_activity", payload: { dayId: "nope", title: "Ghost", time: "10:00" } };

beforeEach(() => {
  runAiPrompt.mockReset();
  runAiPrompt.mockResolvedValue(JSON.stringify({ reply: "Te propongo esto", actions: [validAdd, unknownDay] }));
  db.user = { id: "owner" };
  db.inserted = [];
  db.tables = {
    trips: [{ id: "t1", name: "Madrid", user_id: "owner", start_date: "2026-10-27", end_date: "2026-10-28", travel_context: null }],
    trip_shares: [
      { trip_id: "t1", shared_with: "ed", role: "editor" },
      { trip_id: "t1", shared_with: "vi", role: "viewer" },
    ],
    trip_days: [{ id: "d1", trip_id: "t1", date: "2026-10-27", city: "Madrid", label: "Día 1" }],
    activities: [],
    critical_reservations: [],
    trip_messages: [],
  };
  db.members = [
    { user_id: "owner", email: "hernan@x.io", is_owner: true, display_name: "Hernán L", avatar_url: null },
    { user_id: "ed", email: "jack@x.io", is_owner: false, display_name: "Jack", avatar_url: null },
    { user_id: "vi", email: "marly@x.io", is_owner: false, display_name: null, avatar_url: null },
  ];
});

function assistantRow() {
  return db.inserted.find((row) => row.role === "assistant");
}

const expectedAction = {
  type: "add_activity",
  payload: expect.objectContaining({ dayId: "d1", city: "Madrid", title: "Museo del Prado", time: "10:00", durationMin: 120, category: "sightseeing" }),
};

describe("chat proposals by role", () => {
  it("returns and stores the validated actions for the owner, with a proposal prompt", async () => {
    const response = await post({ tripId: "t1", content: "agrega el Prado", lang: "es" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.actions).toEqual([expectedAction]);
    expect(body.message.actions).toEqual([expectedAction]);
    expect(assistantRow()?.actions).toEqual([expectedAction]);
    const prompt = runAiPrompt.mock.calls[0][0];
    expect(prompt).toContain("PROPOSALS");
    expect(prompt).toContain("add_activity");
    expect(prompt).not.toContain("read-only");
  });

  it("returns the validated actions for a shared editor", async () => {
    db.user = { id: "ed" };
    const body = await (await post({ tripId: "t1", content: "agrega el Prado" })).json();

    expect(body.actions).toEqual([expectedAction]);
    expect(assistantRow()?.actions).toEqual([expectedAction]);
  });

  it("keeps a viewer's Tachi read-only: a reply, no actions", async () => {
    db.user = { id: "vi" };
    const response = await post({ tripId: "t1", content: "agrega el Prado" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message.content).toBe("Te propongo esto");
    expect(body.actions).toEqual([]);
    expect(body.message.actions).toEqual([]);
    expect(assistantRow()?.actions).toEqual([]);
    const prompt = runAiPrompt.mock.calls[0][0];
    expect(prompt).toContain("read-only");
    expect(prompt).not.toContain("PROPOSALS");
  });

  it("tells the owner that earlier refusals in the history no longer apply; a viewer gets no such rule", async () => {
    await post({ tripId: "t1", content: "agrega el Prado" });
    expect(runAiPrompt.mock.calls[0][0]).toContain("no longer apply");

    runAiPrompt.mockClear();
    db.user = { id: "vi" };
    await post({ tripId: "t1", content: "agrega el Prado" });
    expect(runAiPrompt.mock.calls[0][0]).not.toContain("no longer apply");
  });

  it("sends the model only the caller's own conversation, not other travelers' messages", async () => {
    db.tables.trip_messages = [
      { id: "h1", trip_id: "t1", user_id: "owner", role: "user", content: "owner question", actions: null, created_at: "2026-11-01T10:00:00Z" },
      { id: "h2", trip_id: "t1", user_id: "owner", role: "assistant", content: "owner answer", actions: [], created_at: "2026-11-01T10:00:01Z" },
      { id: "h3", trip_id: "t1", user_id: "vi", role: "user", content: "viewer question", actions: null, created_at: "2026-11-02T10:00:00Z" },
      { id: "h4", trip_id: "t1", user_id: "vi", role: "assistant", content: "viewer read-only answer", actions: [], created_at: "2026-11-02T10:00:01Z" },
    ];

    await post({ tripId: "t1", content: "agrega el Prado" });
    const conversation = runAiPrompt.mock.calls[0][1];

    expect(conversation).toContain("user: owner question");
    expect(conversation).toContain("assistant: owner answer");
    expect(conversation).not.toContain("viewer");
    expect(conversation.trim().endsWith("user: agrega el Prado")).toBe(true);
    expect(conversation.match(/agrega el Prado/g)).toHaveLength(1);
  });

  it("still returns the whole shared trip chat to read", async () => {
    db.tables.trip_messages = [
      { id: "h1", trip_id: "t1", user_id: "owner", role: "user", content: "owner question", actions: null, created_at: "2026-11-01T10:00:00Z" },
      { id: "h3", trip_id: "t1", user_id: "vi", role: "user", content: "viewer question", actions: null, created_at: "2026-11-02T10:00:00Z" },
    ];

    const response = await chat.GET(new Request("http://localhost/api/chat?tripId=t1", { headers: { Authorization: "Bearer t" } }));
    const body = await response.json();

    expect(body.messages.map((message: { content: string }) => message.content)).toEqual(["owner question", "viewer question"]);
  });

  it("still rejects a caller without access to the trip", async () => {
    db.user = { id: "stranger" };
    const response = await post({ tripId: "t1", content: "hola" });

    expect(response.status).toBe(403);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });
});

// S1, S4 (odd/tasks/tachi-expenses.md): "jacke y yo pagamos el hotel, marly nos debe 100 euros".
describe("expense proposals", () => {
  const hotel = {
    type: "add_expense",
    payload: {
      title: "Hotel",
      amount: 300,
      category: "lodging",
      payers: [{ userId: "owner" }, { userId: "ed" }],
      split: { method: "equal", participants: ["owner", "ed", "vi"] },
    },
  };
  const expectedHotel = {
    type: "add_expense",
    payload: {
      title: "Hotel",
      amountCents: 30000,
      currency: "EUR",
      spentOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      category: "lodging",
      activityId: null,
      payers: [
        { userId: "owner", paidCents: 15000 },
        { userId: "ed", paidCents: 15000 },
      ],
      splitMethod: "equal",
      splits: [
        { userId: "owner", shareCents: 10000 },
        { userId: "ed", shareCents: 10000 },
        { userId: "vi", shareCents: 10000 },
      ],
      notes: null,
    },
  };

  it("tells the model who the members are and stores the expense in cents", async () => {
    runAiPrompt.mockResolvedValue(JSON.stringify({ reply: "Te propongo este gasto", actions: [hotel] }));
    const body = await (await post({ tripId: "t1", content: "jack y yo pagamos el hotel de 300, marly nos debe 100", lang: "es" })).json();

    expect(body.actions).toEqual([expectedHotel]);
    expect(assistantRow()?.actions).toEqual([expectedHotel]);
    const prompt = runAiPrompt.mock.calls[0][0];
    expect(prompt).toContain('{"id":"owner","name":"Hernán L","isYou":true}');
    expect(prompt).toContain('{"id":"vi","name":"marly","isYou":false}');
    expect(prompt).toContain("add_expense");
    expect(prompt).toContain("Never invent amounts");
  });

  it("lets a viewer propose an expense (any member records expenses) but nothing else", async () => {
    db.user = { id: "vi" };
    runAiPrompt.mockResolvedValue(JSON.stringify({ reply: "Te propongo esto", actions: [validAdd, hotel] }));
    const body = await (await post({ tripId: "t1", content: "pagamos el hotel" })).json();

    expect(body.actions).toEqual([expectedHotel]);
    const prompt = runAiPrompt.mock.calls[0][0];
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("add_expense");
    expect(prompt).not.toContain("add_activity");
  });

  it("drops an expense that does not add up or names a stranger", async () => {
    const wrongSum = { ...hotel, payload: { ...hotel.payload, payers: [{ userId: "owner", amount: 100 }, { userId: "ed", amount: 100 }] } };
    const stranger = { ...hotel, payload: { ...hotel.payload, payers: [{ userId: "nobody" }] } };
    runAiPrompt.mockResolvedValue(JSON.stringify({ reply: "Te propongo esto", actions: [wrongSum, stranger] }));
    const body = await (await post({ tripId: "t1", content: "pagamos el hotel" })).json();
    expect(body.actions).toEqual([]);
  });

  it("proposes no expense when the members cannot be loaded", async () => {
    db.members = null;
    runAiPrompt.mockResolvedValue(JSON.stringify({ reply: "Te propongo esto", actions: [hotel] }));
    const response = await post({ tripId: "t1", content: "pagamos el hotel" });
    expect(response.status).toBe(200);
    expect((await response.json()).actions).toEqual([]);
    expect(runAiPrompt.mock.calls[0][0]).not.toContain("add_expense");
  });
});
