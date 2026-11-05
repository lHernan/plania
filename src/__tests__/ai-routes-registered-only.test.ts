import { beforeEach, describe, expect, it, vi } from "vitest";

// Q14: the AI is for registered users only. Anonymous guests have a session but never reach the AI.
vi.mock("@/lib/ai/provider", () => ({ LONG_REPLY_TIMEOUT_MS: 60_000, runAiPrompt: vi.fn() }));
const auth = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string; is_anonymous?: boolean } | null,
  from: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => ({
    auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.user ? null : { message: "no session" } }) },
    from: auth.from,
  }),
  getServiceRoleSupabase: () => ({ rpc: vi.fn(), from: auth.from }),
}));

const provider = await import("@/lib/ai/provider");
const runAiPrompt = vi.mocked(provider.runAiPrompt);
const chat = await import("@/app/api/chat/route");
const packing = await import("@/app/api/packing-list/route");

const json = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify(body) });

const packingInput = { cities: ["Roma"], weatherSummaries: [], activityBreakdown: {}, luggageDescription: "", durationDays: 3, travelerCount: 1, lang: "es" };

beforeEach(() => {
  auth.user = { id: "anon", is_anonymous: true };
  auth.from.mockReset();
  runAiPrompt.mockReset();
});

describe("AI routes reject anonymous guests", () => {
  it("chat history: 401 without reading the trip", async () => {
    const res = await chat.GET(new Request("http://localhost/api/chat?tripId=t1", { headers: { Authorization: "Bearer t" } }));
    expect(res.status).toBe(401);
    expect(auth.from).not.toHaveBeenCalled();
  });

  it("chat message: 401 without reading the trip or calling the AI", async () => {
    const res = await chat.POST(json("http://localhost/api/chat", { tripId: "t1", content: "hola" }));
    expect(res.status).toBe(401);
    expect(auth.from).not.toHaveBeenCalled();
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("packing list: 401 without calling the AI", async () => {
    const res = await packing.POST(json("http://localhost/api/packing-list", packingInput));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("packing list: 401 without a session", async () => {
    auth.user = null;
    const res = await packing.POST(json("http://localhost/api/packing-list", packingInput));
    expect(res.status).toBe(401);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("packing list: still answers a registered user", async () => {
    auth.user = { id: "u1" };
    runAiPrompt.mockResolvedValue(JSON.stringify({ categories: [{ name: "Ropa", items: [{ name: "Chaqueta", quantity: 1, reason: "frío" }] }] }));
    const res = await packing.POST(json("http://localhost/api/packing-list", packingInput));
    expect(res.status).toBe(200);
    expect((await res.json()).categories[0].items[0]).toMatchObject({ name: "Chaqueta", status: "pending" });
  });
});
