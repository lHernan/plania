import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAiPrompt, runAiVision } from "@/lib/ai/provider";

describe("runAiPrompt output budget", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("AI_API_URL", "https://ai.example.test/v1/chat/completions");
    vi.stubEnv("AI_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL", "test-model");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  it("keeps the default max_tokens of 4000 when no budget is given", async () => {
    await runAiPrompt("system", "user");
    expect(sentBody()).toMatchObject({ model: "test-model", max_tokens: 4000, temperature: 0.1 });
  });

  it("sends the requested max_tokens when a budget is given", async () => {
    await runAiPrompt("system", "user", { maxTokens: 16000 });
    expect(sentBody().max_tokens).toBe(16000);
  });
});

describe("model tiers", () => {
  const fetchMock = vi.fn();
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
  const sentModels = () => fetchMock.mock.calls.map(([url, init]) => `${url} ${JSON.parse(init.body as string).model}`);

  beforeEach(() => {
    vi.stubEnv("AI_API_URL", "https://primary.test");
    vi.stubEnv("AI_API_KEY", "primary-key");
    vi.stubEnv("AI_MODEL", "smart-model");
    vi.stubEnv("AI_FALLBACK_API_URL", "https://fallback.test");
    vi.stubEnv("AI_FALLBACK_API_KEY", "fallback-key");
    vi.stubEnv("AI_FALLBACK_MODEL", "fallback-smart");
    vi.stubEnv("AI_MODEL_FAST", "");
    vi.stubEnv("AI_FALLBACK_MODEL_FAST", "");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the fast models for fast tasks when they are configured", async () => {
    vi.stubEnv("AI_MODEL_FAST", "cheap-model");
    fetchMock.mockResolvedValue(ok());
    await runAiPrompt("system", "user", { tier: "fast" });
    expect(sentModels()).toEqual(["https://primary.test cheap-model"]);
  });

  it("keeps the regular models for tasks without a tier", async () => {
    vi.stubEnv("AI_MODEL_FAST", "cheap-model");
    fetchMock.mockResolvedValue(ok());
    await runAiPrompt("system", "user");
    expect(sentModels()).toEqual(["https://primary.test smart-model"]);
  });

  it("falls back to the regular models for fast tasks when no fast model is set", async () => {
    fetchMock.mockResolvedValue(ok());
    await runAiPrompt("system", "user", { tier: "fast" });
    expect(sentModels()).toEqual(["https://primary.test smart-model"]);
  });

  it("uses the fast fallback model when the primary is down", async () => {
    vi.stubEnv("AI_MODEL_FAST", "cheap-model");
    vi.stubEnv("AI_FALLBACK_MODEL_FAST", "fallback-cheap");
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(ok());
    await runAiPrompt("system", "user", { tier: "fast" });
    expect(sentModels()).toEqual(["https://primary.test cheap-model", "https://fallback.test fallback-cheap"]);
  });

  it("uses the regular fallback model for fast tasks when no fast fallback is set", async () => {
    vi.stubEnv("AI_MODEL_FAST", "cheap-model");
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(ok());
    await runAiPrompt("system", "user", { tier: "fast" });
    expect(sentModels()).toEqual(["https://primary.test cheap-model", "https://fallback.test fallback-smart"]);
  });

  it("sends vision requests to the fast models when asked", async () => {
    vi.stubEnv("AI_MODEL_FAST", "cheap-model");
    fetchMock.mockResolvedValue(ok());
    await runAiVision("system", "user", "data:image/png;base64,AA==", { tier: "fast" });
    expect(sentModels()).toEqual(["https://primary.test cheap-model"]);
  });
});

describe("hung models", () => {
  const fetchMock = vi.fn();
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }), { status: 200 });
  const sentModels = () => fetchMock.mock.calls.map(([url, init]) => `${url} ${JSON.parse(init.body as string).model}`);
  // Never answers; only settles when the request is aborted.
  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("AI_API_URL", "https://primary.test");
    vi.stubEnv("AI_API_KEY", "primary-key");
    vi.stubEnv("AI_MODEL", "slow-model,quick-model");
    vi.stubEnv("AI_FALLBACK_API_URL", "https://fallback.test");
    vi.stubEnv("AI_FALLBACK_API_KEY", "fallback-key");
    vi.stubEnv("AI_FALLBACK_MODEL", "fallback-model");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("moves on to the next model when one does not answer in time", async () => {
    fetchMock.mockImplementationOnce(hang).mockResolvedValueOnce(ok());
    const pending = runAiPrompt("system", "user");
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toBe("{\"ok\":true}");
    expect(sentModels()).toEqual(["https://primary.test slow-model", "https://primary.test quick-model"]);
  });

  it("uses the fallback provider when every primary model times out", async () => {
    fetchMock.mockImplementationOnce(hang).mockImplementationOnce(hang).mockResolvedValueOnce(ok());
    const pending = runAiPrompt("system", "user");
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toBe("{\"ok\":true}");
    expect(sentModels()).toEqual([
      "https://primary.test slow-model",
      "https://primary.test quick-model",
      "https://fallback.test fallback-model",
    ]);
  });

  it("waits longer when the caller asks for a longer timeout", async () => {
    fetchMock.mockImplementationOnce(hang).mockResolvedValueOnce(ok());
    const pending = runAiPrompt("system", "user", { timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toBe("{\"ok\":true}");
  });
});
