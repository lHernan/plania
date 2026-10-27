import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  link: null as Record<string, unknown> | null,
  owner: "u-owner",
  shares: [] as Record<string, unknown>[],
  accepted: [] as string[],
}));

vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => ({ auth: { getUser: async () => ({ data: { user: db.user }, error: db.user ? null : { message: "no session" } }) } }),
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      if (table === "trip_share_links") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.link, error: null }) }) }),
          update: () => ({ eq: (_c: string, id: string) => ({ is: async () => (db.accepted.push(id), { error: null }) }) }),
        };
      }
      if (table === "trips") return { select: () => ({ eq: () => ({ single: async () => ({ data: { user_id: db.owner }, error: null }) }) }) };
      if (table === "trip_shares") return { insert: async (row: Record<string, unknown>) => (db.shares.push(row), { error: null }) };
      throw new Error(table);
    },
  }),
}));

const { POST } = await import("@/app/api/share/[token]/accept/route");
const accept = () => POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ token: "tok" }) });

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  db.user = { id: "u-inv", email: "invitada@test.com" };
  db.link = { id: "l1", trip_id: "trip-1", role: "editor", email: "invitada@test.com", expires_at: null, revoked_at: null };
  db.owner = "u-owner";
  db.shares = [];
  db.accepted = [];
});

describe("POST /api/share/[token]/accept (unchanged behavior)", () => {
  it("adds the invitee with the link's role", async () => {
    const res = await accept();
    expect(await res.json()).toEqual({ success: true, tripId: "trip-1", role: "editor" });
    expect(db.shares).toEqual([{ trip_id: "trip-1", shared_with: "u-inv", role: "editor" }]);
    expect(db.accepted).toEqual(["l1"]);
  });

  it("does nothing for the owner", async () => {
    db.owner = "u-inv";
    expect(await (await accept()).json()).toEqual({ success: true, alreadyOwner: true, tripId: "trip-1" });
    expect(db.shares).toEqual([]);
  });

  it.each([
    ["another email", () => (db.user = { id: "u-x", email: "otra@test.com" }), 403],
    ["an expired link", () => (db.link = { ...db.link, expires_at: "2020-01-01T00:00:00Z" }), 410],
    ["a revoked link", () => (db.link = { ...db.link, revoked_at: "2026-01-01T00:00:00Z" }), 410],
    ["no session", () => (db.user = null), 401],
    ["a publishable key", () => vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_publishable_x"), 500],
  ])("refuses %s", async (_label, arrange, status) => {
    arrange();
    expect((await accept()).status).toBe(status);
    expect(db.shares).toEqual([]);
  });
});
