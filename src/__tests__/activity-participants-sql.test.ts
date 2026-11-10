import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// SQL cannot run here: these checks pin the invariants of the hand-run migration as text.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../lib", file), "utf8").replace(/\s+/g, " ");
const sql = read("activity_participants_migration.sql");

function policy(name: string): string {
  const match = sql.match(new RegExp(`CREATE POLICY "${name}" ON activity_participants (.*?);`));
  expect(match, `policy ${name}`).not.toBeNull();
  return match![1];
}

function fn(name: string): string {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\((.*?)\\$\\$;`));
  expect(match, `function ${name}`).not.toBeNull();
  return match![1];
}

describe("activity_participants migration", () => {
  it("keys participants by activity and person, pinned to the trip, all cascading", () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS activity_participants \( activity_id UUID NOT NULL REFERENCES activities\(id\) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE, .*?trip_id UUID NOT NULL REFERENCES trips\(id\) ON DELETE CASCADE, .*?PRIMARY KEY \(activity_id, user_id\) \)/
    );
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_activity_participants_trip ON activity_participants(trip_id)");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_activity_participants_user ON activity_participants(user_id)");
    expect(sql).toContain("ALTER TABLE activity_participants ENABLE ROW LEVEL SECURITY;");
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it("copies the trip from the activity and only accepts members of that trip", () => {
    const body = fn("activity_participants_before_write");
    expect(body).toContain("SECURITY DEFINER SET search_path = public");
    expect(body).toContain("SELECT trip_id INTO v_trip FROM activities WHERE id = NEW.activity_id");
    expect(body).toContain("NEW.trip_id := v_trip");
    expect(body).toMatch(/trips WHERE id = v_trip AND user_id = NEW\.user_id/);
    expect(body).toMatch(/trip_shares WHERE trip_id = v_trip AND shared_with = NEW\.user_id/);
    expect(sql).toContain("BEFORE INSERT OR UPDATE ON activity_participants");
  });

  it("lets every member read and only the owner or an editor write", () => {
    expect(policy("activity_participants_select")).toContain("FOR SELECT TO authenticated USING (is_trip_member(trip_id, auth.uid()))");
    expect(policy("activity_participants_insert")).toContain("FOR INSERT TO authenticated WITH CHECK (is_trip_owner(trip_id) OR is_trip_editor(trip_id))");
    expect(policy("activity_participants_delete")).toContain("FOR DELETE TO authenticated USING (is_trip_owner(trip_id) OR is_trip_editor(trip_id))");
    expect(sql).not.toMatch(/CREATE POLICY "\w+" ON activity_participants FOR UPDATE/);
    expect(sql).not.toMatch(/TO anon\b/);
  });

  it("replaces the participants of an activity in one call, checking write rights first", () => {
    const body = fn("set_activity_participants");
    expect(body).toMatch(/^p_activity_id UUID, p_user_ids UUID\[\]\)/);
    expect(body).toContain("SECURITY INVOKER");
    expect(body).toMatch(/IF NOT \(is_trip_owner\(v_trip\) OR is_trip_editor\(v_trip\)\) THEN RAISE EXCEPTION .*? USING ERRCODE = '42501'/);
    expect(body).toContain("DELETE FROM activity_participants WHERE activity_id = p_activity_id AND NOT (user_id = ANY(v_ids))");
    expect(body).toContain("ON CONFLICT (activity_id, user_id) DO NOTHING");
    expect(sql).toContain("REVOKE ALL ON FUNCTION set_activity_participants(UUID, UUID[]) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION set_activity_participants(UUID, UUID[]) TO authenticated;");
  });

  it("extends trip_members with a display name and avatar, still answering members only", () => {
    expect(sql).toContain("DROP FUNCTION IF EXISTS trip_members(UUID);");
    const body = fn("trip_members");
    expect(body).toContain("RETURNS TABLE (user_id UUID, email TEXT, is_owner BOOLEAN, display_name TEXT, avatar_url TEXT)");
    expect(body.match(/is_trip_member\(p_trip_id, auth\.uid\(\)\)/g)).toHaveLength(2);
    expect(body).toContain("SECURITY DEFINER SET search_path = public");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION trip_members(UUID) TO authenticated;");
  });

  it("keeps the memories migration re-runnable after the return type change", () => {
    expect(read("trip_memories_migration.sql")).toContain("DROP FUNCTION IF EXISTS trip_members(UUID);");
  });

  it("moves a guest's assignments to the account they sign up with", () => {
    const transfer = read("transfer_anon_data.sql");
    expect(transfer).toContain("IF to_regclass('public.activity_participants') IS NOT NULL THEN");
    expect(transfer).toContain("UPDATE activity_participants a SET user_id = p_new_id");
  });
});
