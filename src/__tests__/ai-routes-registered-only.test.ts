import { beforeEach, describe, expect, it, vi } from "vitest";

// Q14: the AI is for registered users only. Anonymous guests have a session but never reach the AI.
vi.mock("@/lib/ai/provider", () => ({ LONG_REPLY_TIMEOUT_MS: 60_000, runAiPrompt: vi.fn() }));
const detectCodeRegions = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/services/gemini-service", () => ({ geminiService: { detectCodeRegions } }));
const auth = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string; is_anonymous?: boolean } | null,
  from: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => ({
    auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.user ? null : { message: "no session" } }) },
    from: auth.from,
    // Daily AI quota (consume_ai_quota): always allowed here.
    rpc: async () => ({ data: [{ allowed: true, used: 1, remaining: 9 }], error: null }),
  }),
  getServiceRoleSupabase: () => ({ rpc: vi.fn(), from: auth.from }),
}));

const provider = await import("@/lib/ai/provider");
const runAiPrompt = vi.mocked(provider.runAiPrompt);
const chat = await import("@/app/api/chat/route");
const packing = await import("@/app/api/packing-list/route");
const detectCodes = await import("@/app/api/detect-codes/route");
const tripSummary = await import("@/app/api/trips/[tripId]/summary/route");
const memoryCaption = await import("@/app/api/memories/caption/route");

const json = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify(body) });

const packingInput = { cities: ["Roma"], weatherSummaries: [], activityBreakdown: {}, luggageDescription: "", durationDays: 3, travelerCount: 1, lang: "es" };

beforeEach(() => {
  auth.user = { id: "anon", is_anonymous: true };
  auth.from.mockReset();
  runAiPrompt.mockReset();
  detectCodeRegions.mockClear();
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

  it.each([
    ["an anonymous guest", { id: "anon", is_anonymous: true }],
    ["no session", null],
  ])("detect codes: 401 for %s without calling the AI", async (_who, user) => {
    auth.user = user;
    const res = await detectCodes.POST(json("http://localhost/api/detect-codes", { imageUri: "data:image/jpeg;base64,x" }) as never);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(detectCodeRegions).not.toHaveBeenCalled();
  });

  it.each([
    ["an anonymous guest", { id: "anon", is_anonymous: true }],
    ["no session", null],
  ])("trip summary: 401 for %s without reading the trip or calling the AI", async (_who, user) => {
    auth.user = user;
    const res = await tripSummary.POST(json("http://localhost/api/trips/t1/summary", { lang: "es" }), { params: Promise.resolve({ tripId: "t1" }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(auth.from).not.toHaveBeenCalled();
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it.each([
    ["an anonymous guest", { id: "anon", is_anonymous: true }],
    ["no session", null],
  ])("memory caption: 401 for %s without reading the trip or calling the AI", async (_who, user) => {
    auth.user = user;
    const res = await memoryCaption.POST(json("http://localhost/api/memories/caption", { tripId: "t1", activityTitle: "Museo", lang: "es" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(auth.from).not.toHaveBeenCalled();
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("detect codes: still answers a registered user", async () => {
    auth.user = { id: "u1" };
    const res = await detectCodes.POST(json("http://localhost/api/detect-codes", { imageUri: "data:image/jpeg;base64,x" }) as never);
    expect(res.status).toBe(200);
    expect(detectCodeRegions).toHaveBeenCalledTimes(1);
  });
});
