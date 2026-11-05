import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// SQL cannot run here: these checks pin the invariants of the hand-run migrations as text.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../lib", file), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const migration = read("trip_share_link_access_migration.sql");
const legacy = read("trip_share_public_read_migration.sql");

const LINK_POLICIES: [string, string][] = [
  ["trips_select_via_share_link", "trips"],
  ["trip_days_select_via_share_link", "trip_days"],
  ["activities_select_via_share_link", "activities"],
  ["reservations_select_via_share_link", "critical_reservations"],
  ["trip_share_links_select_by_token", "trip_share_links"],
];

const created = (sql: string) => [...sql.matchAll(/CREATE POLICY "([^"]+)" ON (\S+) (.*?);/g)].map((m) => ({ name: m[1], table: m[2], body: m[3] }));

describe("trip_share_link_access migration", () => {
  it.each(LINK_POLICIES)("drops the link policy %s on %s", (name, table) => {
    expect(migration).toContain(`DROP POLICY IF EXISTS "${name}" ON ${table};`);
  });

  it("creates no policy that lets a share link (or anyone) read: links are read only by the server with the service role", () => {
    for (const policy of created(migration)) {
      expect(policy.body, policy.name).not.toMatch(/trip_share_links/);
      expect(policy.body, policy.name).not.toMatch(/USING \(\s*true\s*\)/i);
    }
    expect(migration).not.toMatch(/GRANT [^;]* TO anon/i);
  });

  it("only drops the link-based policies and re-creates activity comments without the link branch", () => {
    const dropped = [...migration.matchAll(/DROP POLICY IF EXISTS "([^"]+)" ON (\S+);/g)].map((m) => `${m[1]} ${m[2]}`).sort();
    expect(dropped).toEqual(
      [...LINK_POLICIES.map(([name, table]) => `${name} ${table}`), "activity_comments_select activity_comments", "activity_comments_insert activity_comments"].sort(),
    );
    const policies = created(migration);
    expect(policies.map((p) => p.name).sort()).toEqual(["activity_comments_insert", "activity_comments_select"]);
    for (const policy of policies) {
      expect(policy.body).toContain("t.user_id = auth.uid()");
      expect(policy.body).toContain("FROM trip_shares ts WHERE ts.trip_id = t.id AND ts.shared_with = auth.uid()");
    }
    expect(policies.find((p) => p.name === "activity_comments_insert")!.body).toContain("ts.role = 'editor'");
  });

  it("leaves owner and member access untouched (no owner, trip_shares or memories policy is dropped)", () => {
    expect(migration).not.toMatch(/DROP POLICY IF EXISTS "(trip_share_links_owner_all|trips_[a-z_]*owner[a-z_]*|[a-z_]*shared[a-z_]*|memor[a-z_]*)"/);
    expect(migration).not.toMatch(/DROP (FUNCTION|TABLE)/i);
  });

  it("the old public-read migration can no longer re-open link reads when re-run", () => {
    expect(created(legacy)).toEqual([]);
    for (const [name, table] of LINK_POLICIES.slice(0, 4)) expect(legacy).toContain(`DROP POLICY IF EXISTS "${name}" ON ${table};`);
  });
});

describe("older migrations cannot reopen link access when re-run", () => {
  it("trip_share_links_migration.sql no longer creates the select-by-token policy", () => {
    const links = read("trip_share_links_migration.sql");
    expect(links).not.toContain('CREATE POLICY "trip_share_links_select_by_token"');
    expect(links).not.toContain("filePath");
  });

  it("activity_comments_migration.sql grants comments to owner and members only", () => {
    expect(read("activity_comments_migration.sql")).not.toContain("trip_share_links");
  });
});
