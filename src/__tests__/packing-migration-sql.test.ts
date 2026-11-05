import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// SQL cannot run here: these checks pin the invariants of the hand-run migrations as text.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../lib", file), "utf8").replace(/\s+/g, " ");

const sql = read("packing_items_migration.sql");

function policy(name: string): string {
  const match = sql.match(new RegExp(`CREATE POLICY "${name}" ON packing_items (.*?);`));
  expect(match, `policy ${name}`).not.toBeNull();
  return match![1];
}

describe("packing_items migration", () => {
  it("is additive and idempotent", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS packing_items");
    expect(sql).not.toMatch(/DROP TABLE|ALTER TABLE (?!packing_items)\w+/);
    for (const name of ["packing_items_select", "packing_items_insert", "packing_items_update", "packing_items_delete"]) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${name}" ON packing_items;`);
    }
  });

  it("enables row level security", () => {
    expect(sql).toContain("ALTER TABLE packing_items ENABLE ROW LEVEL SECURITY;");
  });

  it("keeps the scope, owner and assignment rules in CHECK constraints", () => {
    expect(sql).toContain("CHECK (scope IN ('personal', 'shared'))");
    expect(sql).toContain("CHECK ((scope = 'personal') = (owner_id IS NOT NULL))");
    expect(sql).toContain("CHECK (assigned_to IS NULL OR scope = 'shared')");
    expect(sql).toContain("CHECK (status IN ('pending', 'packed'))");
    expect(sql).toMatch(/quantity INTEGER NOT NULL DEFAULT 1 CHECK \(quantity > 0/);
    expect(sql).toMatch(/name TEXT NOT NULL CHECK \(char_length\(name\) BETWEEN 1 AND 200\)/);
    expect(sql).toContain("trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE");
    expect(sql).toContain("owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(sql).toContain("assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_packing_items_trip_scope ON packing_items(trip_id, scope)");
  });

  it("defines is_trip_member as a SECURITY DEFINER helper with a fixed search_path, callable only when signed in", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION is_trip_member\(p_trip_id UUID, p_user_id UUID\) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION is_trip_member(UUID, UUID) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION is_trip_member(UUID, UUID) TO authenticated;");
  });

  it("lets only the owner of a personal row, still in the trip, read or write it", () => {
    const personal = "(scope = 'personal' AND owner_id = auth.uid() AND is_trip_member(trip_id, auth.uid()))";
    expect(policy("packing_items_select")).toContain(personal);
    expect(policy("packing_items_insert")).toContain(personal);
    expect(policy("packing_items_update")).toContain(personal);
    expect(policy("packing_items_delete")).toContain(personal);
  });

  it("lets every trip member read the shared list and only the owner or editors write it", () => {
    expect(policy("packing_items_select")).toContain("(scope = 'shared' AND is_trip_member(trip_id, auth.uid()))");
    const write = "(scope = 'shared' AND owner_id IS NULL AND (is_trip_owner(trip_id) OR is_trip_editor(trip_id)) AND (assigned_to IS NULL OR is_trip_member(trip_id, assigned_to)))";
    expect(policy("packing_items_insert")).toContain(write);
    const update = policy("packing_items_update");
    expect(update).toMatch(/USING \(.*\) WITH CHECK \(.*\)/);
    expect(update.split("WITH CHECK")[1]).toContain(write);
    expect(policy("packing_items_delete")).toContain("(scope = 'shared' AND (is_trip_owner(trip_id) OR is_trip_editor(trip_id)))");
  });

  it("applies the policies to signed-in users only and records the real author", () => {
    for (const name of ["packing_items_select", "packing_items_insert", "packing_items_update", "packing_items_delete"]) {
      expect(policy(name)).toContain("TO authenticated");
    }
    expect(policy("packing_items_insert")).toContain("created_by IS NOT DISTINCT FROM auth.uid()");
  });

  it("never lets a row move to another trip or change its scope", () => {
    expect(sql).toMatch(/NEW\.trip_id IS DISTINCT FROM OLD\.trip_id OR NEW\.scope IS DISTINCT FROM OLD\.scope/);
    expect(sql).toContain("CREATE TRIGGER packing_items_before_update BEFORE UPDATE ON packing_items");
    expect(sql).toContain("NEW.updated_at := NOW();");
  });

  it("touches no other table's policies", () => {
    const policies = [...sql.matchAll(/(?:CREATE|DROP) POLICY (?:IF EXISTS )?"[^"]+" ON (\w+)/g)].map((m) => m[1]);
    expect(new Set(policies)).toEqual(new Set(["packing_items"]));
  });
});

describe("transfer_anonymous_data", () => {
  const transfer = read("transfer_anon_data.sql");

  it("keeps moving trips and their child rows as before", () => {
    for (const statement of [
      "UPDATE activities SET user_id = p_new_id WHERE user_id = p_anon_id;",
      "UPDATE critical_reservations SET user_id = p_new_id WHERE user_id = p_anon_id;",
      "UPDATE trip_days SET user_id = p_new_id WHERE user_id = p_anon_id;",
      "UPDATE trips SET user_id = p_new_id WHERE user_id = p_anon_id;",
    ]) {
      expect(transfer).toContain(statement);
    }
  });

  it("moves a guest's packing rows to the new account when the table exists", () => {
    expect(transfer).toContain("IF to_regclass('public.packing_items') IS NOT NULL THEN");
    expect(transfer).toContain("UPDATE packing_items SET owner_id = p_new_id WHERE owner_id = p_anon_id;");
    expect(transfer).toContain("UPDATE packing_items SET created_by = p_new_id WHERE created_by = p_anon_id;");
    expect(transfer).toContain("UPDATE packing_items SET assigned_to = p_new_id WHERE assigned_to = p_anon_id;");
  });
});
