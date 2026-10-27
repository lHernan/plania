import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runAiPrompt = vi.fn();
vi.mock("@/lib/ai/provider", () => ({ runAiPrompt: (...args: unknown[]) => runAiPrompt(...args) }));

const auth = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, calls: 0 }));
vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => ({
    auth: {
      getUser: async () => {
        auth.calls += 1;
        return { data: { user: auth.user }, error: auth.user ? null : { message: "no session" } };
      },
    },
  }),
}));

import { POST } from "@/app/api/import/route";

// Every test starts signed in; auth tests opt out explicitly.
beforeEach(() => {
  auth.user = { id: "u1" };
  auth.calls = 0;
});

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function post(body: unknown) {
  return POST(new Request("http://localhost/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const importerReply = {
  activities: [{
    title: "Lunch",
    category: "food",
    location: "Santa Cruz de La Palma",
    date: "2026-11-02",
    time: "13:30",
    duration_minutes: 75,
    notes: "",
    time_confidence: 0.8,
    time_inferred: true,
  }],
};

beforeEach(() => {
  runAiPrompt.mockReset();
  runAiPrompt.mockResolvedValue(JSON.stringify(importerReply));
});

describe("POST /api/import without planning (existing text importer)", () => {
  // Hashes of the system prompt produced by the route before planning support was added.
  it.each([
    ["en", "15e7968dde049e63a8e39e00be1f934d8de3ebe8b75b0c5ce8ed4e108865d14f"],
    ["es", "08db473dd313adc3cca22512fd1e4a609af8693c2c081a751ba94e7525696bef"],
  ])("keeps the %s prompts byte-identical and passes the response through", async (lang, expectedHash) => {
    const response = await post({ text: "Lunch near the port", fallbackDate: "2026-11-02", lang });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(importerReply);
    expect(runAiPrompt).toHaveBeenCalledTimes(1);
    const [systemPrompt, userPrompt] = runAiPrompt.mock.calls[0] as [string, string];
    expect(sha256(systemPrompt)).toBe(expectedHash);
    expect(userPrompt).toBe("FALLBACK_DATE: 2026-11-02\n\nTEXT TO PARSE:\nLunch near the port");
  });

  it("defaults to the English prompt when no language is given", async () => {
    await post({ text: "Lunch", fallbackDate: "2026-11-02" });
    await post({ text: "Lunch", fallbackDate: "2026-11-02", lang: "en" });
    expect(runAiPrompt.mock.calls[0][0]).toBe(runAiPrompt.mock.calls[1][0]);
  });

  it("rejects a request without text exactly as before", async () => {
    const response = await post({ fallbackDate: "2026-11-02", lang: "en" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No text provided" });
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("returns 500 when the model output is not JSON", async () => {
    runAiPrompt.mockResolvedValue("not json");
    const response = await post({ text: "Lunch", fallbackDate: "2026-11-02", lang: "en" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "AI returned invalid JSON" });
  });
});

describe("POST /api/import auth", () => {
  beforeEach(() => {
    runAiPrompt.mockReset();
    auth.user = { id: "u1" };
    auth.calls = 0;
  });

  it("requires a signed-in user for planning and never calls the AI without one", async () => {
    auth.user = null;
    const res = await post({ fallbackDate: "2026-11-01", lang: "es", planning: { context: { tripName: "x", density: "balanced", days: [{ date: "2026-11-01", city: "c", anchors: [], freeWindows: [], maxSuggestions: 1 }] } } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("keeps the existing text import working without a session, as before", async () => {
    auth.user = null;
    runAiPrompt.mockResolvedValue(JSON.stringify({ activities: [] }));
    const res = await post({ text: "Park Güell 08:00", fallbackDate: "2026-11-01", lang: "es" });
    expect(res.status).toBe(200);
    expect(auth.calls).toBe(0);
  });
});

describe("POST /api/import with planning", () => {
  const context = {
    tripName: "La Palma",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    density: "balanced",
    days: [
      {
        date: "2026-11-01",
        city: "La Palma",
        anchors: [{ activityId: "a1", title: "Flight MAD-SPC", kind: "booking", bookingType: "flight", role: "single", start: "08:00", end: "12:50" }],
        freeWindows: [{ start: "13:00", end: "21:30" }],
        maxSuggestions: 1,
      },
      { date: "2026-11-02", city: "La Palma", anchors: [], freeWindows: [{ start: "09:00", end: "21:30" }], maxSuggestions: 3 },
    ],
  };

  it("reuses the importer prompt with the planning addendum and passes the response through", async () => {
    const reply = { activities: importerReply.activities, conflicts: [{ date: "2026-11-01", reason: "no free time after arrival" }] };
    runAiPrompt.mockResolvedValue(JSON.stringify(reply));
    const { buildPlanningAddendum } = await import("@/lib/bookings/planning-prompt");

    const response = await post({ lang: "es", planning: { context, request: "Quiero playas y miradores" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(reply);
    const [systemPrompt, userPrompt] = runAiPrompt.mock.calls[0] as [string, string];
    const addendum = buildPlanningAddendum("es");
    expect(systemPrompt.endsWith(addendum)).toBe(true);
    // The base is exactly the unchanged importer prompt (golden hash above).
    expect(sha256(systemPrompt.slice(0, systemPrompt.length - addendum.length - 2)))
      .toBe("08db473dd313adc3cca22512fd1e4a609af8693c2c081a751ba94e7525696bef");
    expect(systemPrompt.slice(systemPrompt.length - addendum.length - 2, systemPrompt.length - addendum.length)).toBe("\n\n");

    expect(userPrompt.startsWith("FALLBACK_DATE: 2026-11-01\n\n")).toBe(true);
    const json = userPrompt.split("<<<PLANNING_CONTEXT>>>\n")[1]?.split("\n<<<END_PLANNING_CONTEXT>>>")[0];
    expect(JSON.parse(json ?? "null")).toEqual(context);
    expect(userPrompt).toContain("<<<USER_REQUEST>>>\nQuiero playas y miradores\n<<<END_USER_REQUEST>>>");
  });

  it("states the anchoring and honesty rules in the addendum", async () => {
    const { buildPlanningAddendum } = await import("@/lib/bookings/planning-prompt");
    const addendum = buildPlanningAddendum("en");
    for (const fragment of ["free windows", "maxSuggestions", "30-minute", "opening hours", "conflicts", "anchors"]) {
      expect(addendum).toContain(fragment);
    }
  });

  it("works without a free-text request", async () => {
    const response = await post({ lang: "en", planning: { context } });
    expect(response.status).toBe(200);
    const [, userPrompt] = runAiPrompt.mock.calls[0] as [string, string];
    expect(userPrompt).not.toContain("<<<USER_REQUEST>>>");
  });

  it.each([
    ["no context", {}],
    ["days not an array", { context: { ...context, days: "x" } }],
    ["too many days", { context: { ...context, days: Array(32).fill(context.days[1]) } }],
    ["no days", { context: { ...context, days: [] } }],
    ["bad day date", { context: { ...context, days: [{ ...context.days[1], date: "tomorrow" }] } }],
    ["oversized request", { context, request: "x".repeat(2001) }],
    ["oversized title", { context: { ...context, tripName: "x".repeat(201) } }],
    ["planning not an object", "yes"],
  ])("rejects invalid planning input (%s) with 400", async (_label, planning) => {
    const response = await post({ lang: "en", planning });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(runAiPrompt).not.toHaveBeenCalled();
  });
});
