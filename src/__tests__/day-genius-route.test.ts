import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeniusContext } from "@/lib/day-genius/context";

vi.mock("@/lib/ai/provider", () => ({ runAiPrompt: vi.fn() }));
vi.mock("@/lib/weather/day-forecast", () => ({ fetchDayWeather: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null }));
vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => ({
    auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.user ? null : { message: "no session" } }) },
  }),
}));

const provider = await import("@/lib/ai/provider");
const weatherModule = await import("@/lib/weather/day-forecast");
const { POST } = await import("@/app/api/day-genius/route");
const runAiPrompt = vi.mocked(provider.runAiPrompt);
const fetchDayWeather = vi.mocked(weatherModule.fetchDayWeather);

const context: GeniusContext = {
  date: "2026-11-02",
  city: "La Palma",
  mode: "today",
  now: "12:20",
  windowStart: "12:20",
  dayEnd: "22:00",
  fixed: [
    { id: "hike", title: "Caldera de Taburiente", kind: "ongoing", start: "09:00", end: "12:20", location: "Caldera de Taburiente" },
    { id: "car", title: "Car drop-off", kind: "booking", start: "18:30", end: "19:30" },
  ],
  movable: [
    { id: "lunch", title: "Almuerzo", category: "food", priority: "medium", location: "Los Llanos", time: "12:00", durationMin: 60, status: "overdue" },
    { id: "park", title: "Parque Cubo de la Galga", category: "sightseeing", priority: "medium", location: "Puntallana", time: "14:00", durationMin: 120, status: "upcoming" },
  ],
  travel: [{ from: "hike", to: "lunch", km: 8.2, minutes: 29, mode: "ride" }],
  otherDays: [{ date: "2026-11-03", city: "La Palma", freeWindows: [{ start: "09:00", end: "21:30" }] }],
};

const rainyWeather = {
  hours: [{ time: "14:00", condition: "rain" as const, precipProbability: 90, precipMm: 3, tempC: 18 }],
  days: [{ date: "2026-11-03", condition: "clear" as const, precipProbabilityMax: 5, tempMaxC: 23, tempMinC: 17 }],
};

const modelReply = {
  summary: "Llueve por la tarde: el parque pasa a mañana y te proponemos un museo.",
  schedule: [{ id: "lunch", time: "13:00", duration_minutes: 60, reason: "Venís 29 min en coche desde la Caldera" }],
  move_to_other_day: [{ id: "park", date: "2026-11-03", time: "10:00", reason: "90% de lluvia a las 14:00; mañana despejado" }],
  suggestions: [{ title: "Museo Insular", category: "sightseeing", location: "Santa Cruz de La Palma", time: "15:00", duration_minutes: 90, notes: "Verificá el horario", reason: "Bajo techo", replaces_id: "park" }],
};

function post(body: unknown) {
  return POST(new Request("http://localhost/api/day-genius", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const valid = { context, today: "2026-11-02", lang: "es", weatherCoords: { lat: 28.68, lng: -17.76 } };

describe("POST /api/day-genius", () => {
  beforeEach(() => {
    auth.user = { id: "u1" };
    runAiPrompt.mockReset();
    fetchDayWeather.mockReset();
    fetchDayWeather.mockResolvedValue(rainyWeather);
  });

  it("requires a signed-in user and never calls the AI without one", async () => {
    auth.user = null;
    const res = await post(valid);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(runAiPrompt).not.toHaveBeenCalled();
    expect(fetchDayWeather).not.toHaveBeenCalled();
  });

  it("plans with the weather and returns only validated changes", async () => {
    runAiPrompt.mockResolvedValue(JSON.stringify(modelReply));
    const res = await post(valid);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe(modelReply.summary);
    expect(body.weather).toEqual(rainyWeather);
    expect(body.changes.map((c: { kind: string }) => c.kind)).toEqual(["reschedule", "add", "move_day"]);
    expect(body.changes[1]).toMatchObject({ replacesId: "park", suggestion: { title: "Museo Insular", time: "15:00" } });

    expect(fetchDayWeather).toHaveBeenCalledWith({
      city: "La Palma",
      coords: { lat: 28.68, lng: -17.76 },
      date: "2026-11-02",
      fromTime: "12:20",
      dayEnd: "22:00",
      otherDates: ["2026-11-03"],
      today: "2026-11-02",
    });
    const [system, user, options] = runAiPrompt.mock.calls[0];
    expect(system).toMatch(/rain/i);
    expect(system).toMatch(/Spanish/);
    expect(options).toEqual({ maxTokens: 16000 });
    const json = user.split("<<<DAY_CONTEXT>>>\n")[1]?.split("\n<<<END_DAY_CONTEXT>>>")[0];
    expect(JSON.parse(json ?? "null")).toEqual({ ...context, weather: rainyWeather });
  });

  it("drops what breaks the rules and reports it", async () => {
    runAiPrompt.mockResolvedValue(JSON.stringify({ schedule: [{ id: "lunch", time: "18:45", duration_minutes: 60, reason: "x" }, { id: "intruder", time: "15:00", duration_minutes: 30 }] }));
    const body = await (await post(valid)).json();
    expect(body.changes).toEqual([]);
    expect(body.rejected).toEqual(expect.arrayContaining([{ ref: "intruder", reason: "unknown_id" }, { ref: "lunch", reason: "overlap" }]));
  });

  it("plans without weather when it is unavailable and says so to the model", async () => {
    fetchDayWeather.mockResolvedValue(null);
    runAiPrompt.mockResolvedValue(JSON.stringify({ summary: "ok" }));
    const body = await (await post(valid)).json();
    expect(body.weather).toBeNull();
    expect(runAiPrompt.mock.calls[0][1]).toContain('"weather":null');
  });

  it.each([
    ["provider failure", () => runAiPrompt.mockRejectedValue(new Error("AI Provider error"))],
    ["unparseable output", () => runAiPrompt.mockResolvedValue("lo siento, no puedo")],
  ])("returns 502 genius_failed on %s", async (_label, arrange) => {
    arrange();
    const res = await post(valid);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "genius_failed" });
  });

  it.each([
    ["invalid JSON", "{nope"],
    ["no context", { today: "2026-11-02" }],
    ["bad today", { ...valid, today: "02/11/2026" }],
    ["bad lang", { ...valid, lang: "fr" }],
    ["bad window", { ...valid, context: { ...context, windowStart: "25:00" } }],
    ["bad mode", { ...valid, context: { ...context, mode: "yesterday" } }],
    ["bad movable", { ...valid, context: { ...context, movable: [{ ...context.movable[0], durationMin: -5 }] } }],
    ["unknown category", { ...valid, context: { ...context, movable: [{ ...context.movable[0], category: "spa" }] } }],
    ["too many movable", { ...valid, context: { ...context, movable: Array.from({ length: 41 }, (_, i) => ({ ...context.movable[0], id: `m${i}` })) } }],
    ["bad coords", { ...valid, weatherCoords: { lat: "x", lng: 1 } }],
    ["oversized title", { ...valid, context: { ...context, movable: [{ ...context.movable[0], title: "x".repeat(300) }] } }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("does not forward unknown fields to the model", async () => {
    runAiPrompt.mockResolvedValue(JSON.stringify({ summary: "ok" }));
    await post({ ...valid, context: { ...context, secret: "do not send", movable: [{ ...context.movable[0], notes: "private" }] } });
    expect(runAiPrompt.mock.calls[0][1]).not.toContain("do not send");
    expect(runAiPrompt.mock.calls[0][1]).not.toContain("private");
  });
});
