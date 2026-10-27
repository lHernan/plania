import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_SHA, FLIGHT_DOC } from "./fixtures/bookings/documents";
import { FLIGHT_RESPONSE } from "./fixtures/bookings/model-responses";

vi.mock("@/lib/ai/provider", () => ({
  runAiPrompt: vi.fn(),
  runAiVisionPages: vi.fn(),
}));

const auth = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null }));
vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => ({
    auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.user ? null : { message: "no session" } }) },
  }),
}));

const provider = await import("@/lib/ai/provider");
const { POST } = await import("@/app/api/bookings/extract/route");
const runAiPrompt = vi.mocked(provider.runAiPrompt);
const runAiVisionPages = vi.mocked(provider.runAiVisionPages);

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function request(body: unknown) {
  return new Request("http://localhost/api/bookings/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const base = { fileName: "flight.pdf", sha256: FAKE_SHA };

describe("POST /api/bookings/extract", () => {
  beforeEach(() => {
    auth.user = { id: "u1" };
    runAiPrompt.mockReset();
    runAiVisionPages.mockReset();
  });

  it("rejects requests without a signed-in user and never calls the AI provider", async () => {
    auth.user = null;
    const res = await POST(request({ ...base, pages: [{ index: 0, text: FLIGHT_DOC }] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(runAiPrompt).not.toHaveBeenCalled();
    expect(runAiVisionPages).not.toHaveBeenCalled();
  });

  it("extracts bookings from text pages", async () => {
    runAiPrompt.mockResolvedValue("```json\n" + JSON.stringify(FLIGHT_RESPONSE) + "\n```");
    const res = await POST(request({ ...base, pages: [{ index: 0, text: FLIGHT_DOC }], lang: "en" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings).toEqual([]);
    expect(body.bookings).toHaveLength(2);
    expect(body.bookings[0]).toMatchObject({ type: "flight", reference: "ZZ9TST", source: base, id: `${FAKE_SHA.slice(0, 8)}-0` });
    expect(runAiPrompt).toHaveBeenCalledTimes(1);
    expect(runAiPrompt.mock.calls[0][1]).toContain("<<<DOCUMENT");
    expect(runAiPrompt.mock.calls[0][1]).toContain("ZZ9TST");
    expect(runAiVisionPages).not.toHaveBeenCalled();
  });

  it("reads text pages and scanned pages together in mixed documents", async () => {
    runAiVisionPages.mockResolvedValue(JSON.stringify(FLIGHT_RESPONSE));
    const res = await POST(request({ ...base, pages: [{ index: 0, text: FLIGHT_DOC }, { index: 1, text: "" }], images: [PNG] }));
    expect(res.status).toBe(200);
    expect(runAiPrompt).not.toHaveBeenCalled();
    expect(runAiVisionPages).toHaveBeenCalledTimes(1);
    const [, userPrompt, images] = runAiVisionPages.mock.calls[0];
    expect(userPrompt).toContain("ZZ9TST");
    expect(images).toEqual([PNG]);
    expect((await res.json()).bookings).toHaveLength(2);
  });

  it("uses vision for scanned documents", async () => {
    runAiVisionPages.mockResolvedValue(JSON.stringify(FLIGHT_RESPONSE));
    const res = await POST(request({ ...base, pages: [{ index: 0, text: "  " }], images: [PNG, PNG] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bookings).toHaveLength(2);
    expect(body.warnings).toEqual([]);
    expect(runAiVisionPages).toHaveBeenCalledTimes(1);
    expect(runAiVisionPages.mock.calls[0][2]).toEqual([PNG, PNG]);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("returns 422 no_text for an empty document", async () => {
    const res = await POST(request({ ...base, pages: [{ index: 0, text: " \n " }] }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "no_text" });
    expect(runAiPrompt).not.toHaveBeenCalled();
    expect(runAiVisionPages).not.toHaveBeenCalled();
  });

  it("returns 502 extraction_failed when the provider throws", async () => {
    runAiPrompt.mockRejectedValue(new Error("AI Provider error"));
    const res = await POST(request({ ...base, pages: [{ index: 0, text: FLIGHT_DOC }] }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "extraction_failed" });
  });

  it("returns no bookings and a warning for unparseable model output", async () => {
    runAiPrompt.mockResolvedValue("Sorry, I cannot help with that.");
    const res = await POST(request({ ...base, pages: [{ index: 0, text: FLIGHT_DOC }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bookings: [], warnings: ["unparseable_response"] });
  });

  it("warns when the document text was truncated", async () => {
    runAiPrompt.mockResolvedValue(JSON.stringify({ bookings: [] }));
    const pages = Array.from({ length: 10 }, (_, index) => ({ index, text: "y".repeat(9000) }));
    const res = await POST(request({ ...base, pages }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bookings: [], warnings: ["text_truncated"] });
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["missing fileName", { sha256: FAKE_SHA, pages: [] }],
    ["bad sha256", { fileName: "a.pdf", sha256: "xyz", pages: [] }],
    ["too many pages", { ...base, pages: Array.from({ length: 61 }, (_, index) => ({ index, text: "a" })) }],
    ["too many images", { ...base, pages: [], images: [PNG, PNG, PNG, PNG, PNG] }],
    ["non-png image", { ...base, pages: [], images: ["data:image/jpeg;base64,AAAA"] }],
    ["oversized image", { ...base, pages: [], images: [PNG + "A".repeat(3 * 1024 * 1024)] }],
    ["bad lang", { ...base, pages: [{ index: 0, text: FLIGHT_DOC }], lang: "fr" }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(runAiPrompt).not.toHaveBeenCalled();
    expect(runAiVisionPages).not.toHaveBeenCalled();
  });
});
