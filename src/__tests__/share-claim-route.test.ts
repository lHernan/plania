import { beforeEach, describe, expect, it, vi } from "vitest";

type Link = { id: string; trip_id: string; role: "viewer" | "editor"; email: string | null; expires_at: string | null; revoked_at: string | null; accepted_by: string | null };

const db = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  links: [] as Link[],
  trips: {} as Record<string, string>,
  shares: [] as { trip_id: string; shared_with: string; role: string }[],
  accepted: [] as { id: string; accepted_by: string }[],
  linkFilters: [] as [string, string, unknown][],
}));

vi.mock("@/lib/supabase-server", () => ({
  getAuthClient: () => ({ auth: { getUser: async () => ({ data: { user: db.user }, error: db.user ? null : { message: "no session" } }) } }),
  getServiceRoleSupabase: () => ({
    from: (table: string) => {
      if (table === "trip_share_links") {
        const filters: [string, string, unknown][] = [];
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => (filters.push(["eq", column, value]), query),
          is: (column: string, value: unknown) => (filters.push(["is", column, value]), query),
          then: (resolve: (r: unknown) => void) => {
            db.linkFilters = filters;
            const rows = db.links.filter((l) => filters.every(([, column, value]) => (l as Record<string, unknown>)[column] === value));
            resolve({ data: rows, error: null });
          },
          update: (row: { accepted_by: string }) => ({
            eq: (_c: string, id: string) => ({
              is: async () => {
                db.accepted.push({ id, accepted_by: row.accepted_by });
                return { error: null };
              },
            }),
          }),
        };
        return query;
      }
      if (table === "trips") {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({ single: async () => ({ data: db.trips[id] ? { user_id: db.trips[id] } : null, error: null }) }),
          }),
        };
      }
      if (table === "trip_shares") {
        return {
          insert: async (row: { trip_id: string; shared_with: string; role: string }) => {
            if (db.shares.some((s) => s.trip_id === row.trip_id && s.shared_with === row.shared_with)) return { error: { code: "23505" } };
            db.shares.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const { POST } = await import("@/app/api/share/claim/route");

const call = () => POST(new Request("http://localhost/api/share/claim", { method: "POST", headers: { Authorization: "Bearer t" } }));
const link = (id: string, trip: string, extra: Partial<Link> = {}): Link => ({
  id, trip_id: trip, role: "viewer", email: "invitada@test.com", expires_at: null, revoked_at: null, accepted_by: null, ...extra,
});

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  db.user = { id: "u-inv", email: "Invitada@Test.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
  db.links = [];
  db.trips = { "trip-1": "u-owner", "trip-2": "u-owner", "trip-own": "u-inv" };
  db.shares = [];
  db.accepted = [];
});

describe("POST /api/share/claim", () => {
  it("grants every pending invitation sent to the signed-in email", async () => {
    db.links = [
      link("l1", "trip-1", { role: "editor" }),
      link("l2", "trip-2", { expires_at: "2020-01-01T00:00:00Z" }),
      link("l3", "trip-2", { email: "otra@test.com" }),
      link("l4", "trip-own"),
    ];
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tripIds: ["trip-1"] });
    expect(db.shares).toEqual([{ trip_id: "trip-1", shared_with: "u-inv", role: "editor" }]);
    expect(db.accepted).toEqual([{ id: "l1", accepted_by: "u-inv" }]);
    // Exact (lowercased) email match: no LIKE wildcards; revoked and accepted links excluded.
    expect(db.linkFilters).toEqual([["eq", "email", "invitada@test.com"], ["is", "revoked_at", null], ["is", "accepted_by", null]]);
  });

  it("is harmless to call again", async () => {
    db.links = [link("l1", "trip-1")];
    await call();
    db.links[0].accepted_by = "u-inv";
    expect(await (await call()).json()).toEqual({ tripIds: [] });
    expect(db.shares).toHaveLength(1);
  });

  it.each([
    ["no session", null],
    ["an anonymous guest", { id: "g", is_anonymous: true, email: "invitada@test.com", email_confirmed_at: "2026-10-01" }],
  ])("refuses %s", async (_label, user) => {
    db.user = user;
    db.links = [link("l1", "trip-1")];
    expect((await call()).status).toBe(401);
    expect(db.shares).toEqual([]);
  });

  it("does not grant invitations to an email that was never confirmed", async () => {
    db.user = { id: "u-x", email: "invitada@test.com", email_confirmed_at: null };
    db.links = [link("l1", "trip-1")];
    expect(await (await call()).json()).toEqual({ tripIds: [] });
    expect(db.shares).toEqual([]);
  });
});
