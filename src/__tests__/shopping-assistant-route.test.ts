import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/provider", () => ({ runAiPrompt: vi.fn() }));
const auth = vi.hoisted(() => ({ user: null as { id: string; is_anonymous?: boolean } | null }));
vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => ({
    auth: { getUser: async () => ({ data: { user: auth.user }, error: auth.user ? null : { message: "no session" } }) },
  }),
}));

const provider = await import("@/lib/ai/provider");
const { POST } = await import("@/app/api/shopping-assistant/route");
const runAiPrompt = vi.mocked(provider.runAiPrompt);

function post(body: unknown) {
  return POST(new Request("http://localhost/api/shopping-assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
    body: JSON.stringify(body),
  }));
}

const wishlist = { type: "wishlist_input", text: "comprar mojo picon, recuerdo para la abuela", lang: "es", shopping_list: [] };
const names = async (res: Response) => ((await res.json()).wishlist_items as { name: string }[]).map((i) => i.name);

describe("POST /api/shopping-assistant wishlist_input", () => {
  beforeEach(() => {
    auth.user = null;
    runAiPrompt.mockReset();
  });

  it("splits a guest's text with the rules, without calling the AI", async () => {
    const res = await post(wishlist);
    expect(res.status).toBe(200);
    expect(await names(res)).toEqual(["Mojo picon", "Recuerdo para la abuela"]);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("does not spend AI on anonymous sessions either", async () => {
    auth.user = { id: "g", is_anonymous: true };
    await post(wishlist);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });

  it("uses the fast AI model for signed-in users and returns validated items", async () => {
    auth.user = { id: "u1" };
    runAiPrompt.mockResolvedValue(JSON.stringify({
      items: [
        { name: "Mojo picón", category: "food", shop_categories: ["commercial.supermarket"] },
        { name: "Recuerdo para la abuela", category: "souvenir", shop_categories: ["commercial.gift_and_souvenir"] },
      ],
    }));
    const res = await post(wishlist);
    const body = await res.json();
    expect(body.wishlist_items.map((i: { name: string; shopCategories: string[] }) => [i.name, i.shopCategories])).toEqual([
      ["Mojo picón", ["commercial.supermarket"]],
      ["Recuerdo para la abuela", ["commercial.gift_and_souvenir"]],
    ]);
    const [system, user, options] = runAiPrompt.mock.calls[0];
    expect(system).toMatch(/Spanish/);
    expect(user).toContain("comprar mojo picon, recuerdo para la abuela");
    expect(options).toEqual({ tier: "fast" });
  });

  it.each([
    ["provider failure", () => runAiPrompt.mockRejectedValue(new Error("AI Provider error"))],
    ["unusable output", () => runAiPrompt.mockResolvedValue("lo siento")],
  ])("falls back to the rules on %s", async (_label, arrange) => {
    auth.user = { id: "u1" };
    arrange();
    expect(await names(await post(wishlist))).toEqual(["Mojo picon", "Recuerdo para la abuela"]);
  });

  it("rejects text that is too long", async () => {
    const res = await post({ ...wishlist, text: "x".repeat(1001) });
    expect(res.status).toBe(400);
    expect(runAiPrompt).not.toHaveBeenCalled();
  });
});
