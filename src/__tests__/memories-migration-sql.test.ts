import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// SQL cannot run here: these checks pin the invariants of the hand-run migration as text.
const read = (file: string) => readFileSync(path.resolve(__dirname, "../lib", file), "utf8").replace(/\s+/g, " ");
const sql = read("trip_memories_migration.sql");
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function policy(name: string, table: string): string {
  const match = sql.match(new RegExp(`CREATE POLICY "${name}" ON ${table.replace(".", "\\.")} (.*?);`));
  expect(match, `policy ${name}`).not.toBeNull();
  return match![1];
}

function fn(name: string): string {
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\((.*?)\\$\\$;`));
  expect(match, `function ${name}`).not.toBeNull();
  return match![1];
}

const POLICIES: [string, string, string][] = [
  ["memories_select", "memories", "SELECT"],
  ["memories_insert", "memories", "INSERT"],
  ["memories_update", "memories", "UPDATE"],
  ["memories_delete", "memories", "DELETE"],
  ["memory_audience_select", "memory_audience", "SELECT"],
  ["memory_audience_insert", "memory_audience", "INSERT"],
  ["memory_audience_delete", "memory_audience", "DELETE"],
  ["memory_photos_select", "memory_photos", "SELECT"],
  ["memory_photos_insert", "memory_photos", "INSERT"],
  ["memory_photos_update", "memory_photos", "UPDATE"],
  ["memory_photos_delete", "memory_photos", "DELETE"],
  ["trip_memories_select", "storage.objects", "SELECT"],
  ["trip_memories_insert", "storage.objects", "INSERT"],
  ["trip_memories_update", "storage.objects", "UPDATE"],
  ["trip_memories_delete", "storage.objects", "DELETE"],
];

describe("trip_memories migration: tables", () => {
  it("creates the three tables idempotently and never drops anything", () => {
    for (const table of ["memories", "memory_audience", "memory_photos"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    }
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER TABLE (?!memories |memory_audience |memory_photos )\w+/);
  });

  it("ties a memory to its trip, an optional activity and its author, with bounded fields", () => {
    expect(sql).toContain("trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE");
    expect(sql).toContain("activity_id UUID REFERENCES activities(id) ON DELETE SET NULL");
    expect(sql).toContain("author_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(sql).toContain("rating SMALLINT CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)");
    expect(sql).toContain("audience TEXT NOT NULL DEFAULT 'trip' CHECK (audience IN ('trip', 'selected'))");
    expect(sql).toMatch(/note TEXT CHECK \(note IS NULL OR char_length\(note\) <= \d+\)/);
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_memories_trip_activity ON memories(trip_id, activity_id)");
  });

  it("keys the audience by memory and person, both cascading", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS memory_audience \( memory_id UUID NOT NULL REFERENCES memories\(id\) ON DELETE CASCADE, user_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE, PRIMARY KEY \(memory_id, user_id\) \)/);
  });

  it("pins each photo path to its own trip and memory folder", () => {
    expect(sql).toContain("memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE");
    expect(sql).toContain(`path ~ ('^' || trip_id::text || '/' || memory_id::text || '/${UUID}\\.(jpg|png|webp)$')`);
    expect(sql).toMatch(/caption TEXT CHECK \(caption IS NULL OR char_length\(caption\) <= \d+\)/);
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_photos_path ON memory_photos(path)");
  });

  it("keeps the activity in the trip, trip and author immutable, and the photo trip equal to the memory's", () => {
    expect(fn("memories_check_activity")).toContain("SELECT 1 FROM activities WHERE id = NEW.activity_id AND trip_id = NEW.trip_id");
    expect(sql).toContain("CREATE TRIGGER memories_check_activity BEFORE INSERT OR UPDATE ON memories");
    const update = fn("memories_before_update");
    expect(update).toContain("NEW.trip_id IS DISTINCT FROM OLD.trip_id");
    expect(update).toContain("NEW.author_id IS DISTINCT FROM OLD.author_id");
    expect(update).toContain("NEW.updated_at := NOW();");
    expect(sql).toContain("CREATE TRIGGER memories_before_update BEFORE UPDATE ON memories");
    const photos = fn("memory_photos_before_write");
    expect(photos).toContain("SELECT trip_id INTO v_trip FROM memories WHERE id = NEW.memory_id;");
    expect(photos).toContain("NEW.trip_id IS DISTINCT FROM v_trip");
    expect(sql).toContain("CREATE TRIGGER memory_photos_before_write BEFORE INSERT OR UPDATE ON memory_photos");
  });
});

describe("trip_memories migration: helpers", () => {
  it.each(["can_see_memory(UUID)", "is_memory_author(UUID)", "memory_audience_member_ok(UUID, UUID)", "trip_members(UUID)", "can_write_memory_object(TEXT)", "can_read_memory_object(TEXT)"])(
    "%s is SECURITY DEFINER with a fixed search_path and only callable when signed in",
    (signature) => {
      const name = signature.split("(")[0];
      expect(fn(name)).toMatch(/SECURITY DEFINER SET search_path = public AS \$\$/);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`);
    },
  );

  it("can_see_memory requires current membership and then author, whole trip or audience", () => {
    const body = fn("can_see_memory");
    expect(body).toContain("is_trip_member(m.trip_id, auth.uid())");
    expect(body).toContain("m.author_id = auth.uid() OR m.audience = 'trip' OR EXISTS (SELECT 1 FROM memory_audience a WHERE a.memory_id = m.id AND a.user_id = auth.uid())");
  });

  it("trip_members answers only members and lists the owner and every share with their email", () => {
    const body = fn("trip_members");
    expect(body).toContain("RETURNS TABLE (user_id UUID, email TEXT, is_owner BOOLEAN)");
    expect(body.match(/is_trip_member\(p_trip_id, auth\.uid\(\)\)/g)).toHaveLength(2);
    expect(body).toContain("JOIN auth.users u ON u.id = t.user_id");
    expect(body).toContain("FROM trip_shares s");
  });

  it("checks object names against the full uuid layout before casting folders", () => {
    const body = fn("can_write_memory_object");
    const guard = body.indexOf("p_name !~");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("::uuid"));
    expect(body).toContain("m.id = v_folders[2]::uuid AND m.trip_id = v_folders[1]::uuid AND m.author_id = auth.uid()");
    expect(fn("can_read_memory_object")).toContain("WHERE p.path = p_name AND can_see_memory(p.memory_id)");
  });
});

describe("trip_memories migration: policies", () => {
  it.each(POLICIES)("%s is recreated for %s %s, for signed-in users only", (name, table, operation) => {
    expect(sql).toContain(`DROP POLICY IF EXISTS "${name}" ON ${table};`);
    expect(policy(name, table).startsWith(`FOR ${operation} TO authenticated`)).toBe(true);
  });

  it("grants nothing to anon and only the expected policies exist", () => {
    expect(sql).not.toMatch(/TO anon/);
    const created = [...sql.matchAll(/CREATE POLICY "([^"]+)" ON ([\w.]+)/g)].map((m) => `${m[1]}@${m[2]}`);
    expect(created.sort()).toEqual(POLICIES.map(([name, table]) => `${name}@${table}`).sort());
  });

  it("memories: visible per can_see_memory; written only by the author while a member", () => {
    expect(policy("memories_select", "memories")).toContain("OR can_see_memory(id)");
    const own = "author_id = auth.uid() AND is_trip_member(trip_id, auth.uid())";
    expect(policy("memories_insert", "memories")).toContain(`WITH CHECK ( ${own} )`);
    expect(policy("memories_update", "memories")).toContain(`USING ( ${own} ) WITH CHECK ( ${own} )`);
    expect(policy("memories_delete", "memories")).toContain(`USING ( ${own} )`);
  });

  it("memory_audience: visible with the memory; only the author adds trip members or removes them", () => {
    expect(policy("memory_audience_select", "memory_audience")).toContain("USING (can_see_memory(memory_id))");
    expect(policy("memory_audience_insert", "memory_audience")).toContain("is_memory_author(memory_id) AND memory_audience_member_ok(memory_id, user_id)");
    expect(policy("memory_audience_delete", "memory_audience")).toContain("USING (is_memory_author(memory_id))");
    expect(fn("memory_audience_member_ok")).toContain("is_trip_member(m.trip_id, p_user_id)");
  });

  it("memory_photos: visible with the memory; written only by the author", () => {
    expect(policy("memory_photos_select", "memory_photos")).toContain("USING (can_see_memory(memory_id))");
    expect(policy("memory_photos_insert", "memory_photos")).toContain("WITH CHECK (is_memory_author(memory_id))");
    expect(policy("memory_photos_update", "memory_photos")).toContain("USING (is_memory_author(memory_id)) WITH CHECK (is_memory_author(memory_id))");
    expect(policy("memory_photos_delete", "memory_photos")).toContain("USING (is_memory_author(memory_id))");
  });

  it("storage: private 10 MB image bucket; reads follow the photo's memory, writes need its author", () => {
    expect(sql).toMatch(/VALUES \('trip-memories', 'trip-memories', false, 10485760, ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]\) ON CONFLICT \(id\) DO UPDATE SET public = false/);
    expect(sql).not.toMatch(/'trip-memories', true/);
    for (const [name, , operation] of POLICIES.filter(([, table]) => table === "storage.objects")) {
      const body = policy(name, "storage.objects");
      expect(body).toContain("bucket_id = 'trip-memories'");
      if (operation === "SELECT") expect(body).toContain("can_read_memory_object(name)");
      else expect(body).toContain("can_write_memory_object(name)");
    }
  });
});

describe("trip_memories migration: removed members", () => {
  it("drops their audience rows of that trip when a share is deleted", () => {
    expect(sql).toContain("CREATE TRIGGER memory_audience_remove_member AFTER DELETE ON trip_shares");
    expect(fn("memory_audience_remove_member")).toContain("DELETE FROM memory_audience WHERE user_id = OLD.shared_with AND memory_id IN (SELECT id FROM memories WHERE trip_id = OLD.trip_id)");
    expect(fn("memory_audience_remove_member")).toContain("SECURITY DEFINER SET search_path = public");
  });
});

describe("transfer_anonymous_data and memories", () => {
  const transfer = read("transfer_anon_data.sql");

  it("keeps the existing statements", () => {
    for (const statement of [
      "UPDATE activities SET user_id = p_new_id WHERE user_id = p_anon_id;",
      "UPDATE trips SET user_id = p_new_id WHERE user_id = p_anon_id;",
      "UPDATE packing_items SET owner_id = p_new_id WHERE owner_id = p_anon_id;",
    ]) {
      expect(transfer).toContain(statement);
    }
  });

  it("moves a guest's memories and audience rows only when the tables exist", () => {
    expect(transfer).toContain("IF to_regclass('public.memories') IS NOT NULL THEN PERFORM set_config('plania.memories_transfer', 'on', true); UPDATE memories SET author_id = p_new_id WHERE author_id = p_anon_id;");
    expect(transfer).toContain("IF to_regclass('public.memory_audience') IS NOT NULL THEN UPDATE memory_audience a SET user_id = p_new_id");
    expect(transfer).toContain("DELETE FROM memory_audience WHERE user_id = p_anon_id;");
    // The trigger honors exactly the flag the transfer sets.
    expect(sql).toContain("current_setting('plania.memories_transfer', true) IS DISTINCT FROM 'on'");
  });
});
