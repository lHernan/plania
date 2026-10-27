import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAiPrompt } from "@/lib/ai/provider";

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
