import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// SQL cannot run here: these checks pin the invariants of the hand-run migration as text.
const sql = readFileSync(path.resolve(__dirname, "../lib/trip_covers_migration.sql"), "utf8").replace(/\s+/g, " ");

function policy(name: string): string {
  const match = sql.match(new RegExp(`CREATE POLICY "${name}" ON storage\\.objects (.*?);`));
  expect(match, `policy ${name}`).not.toBeNull();
  return match![1];
}

describe("trip_covers migration", () => {
  it("adds the cover column idempotently, with a path format check tied to the trip id", () => {
    expect(sql).toContain("ALTER TABLE trips ADD COLUMN IF NOT EXISTS cover_path TEXT");
    expect(sql).toContain("ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_cover_path_format;");
    expect(sql).toMatch(/ADD CONSTRAINT trips_cover_path_format CHECK \( cover_path IS NULL OR cover_path ~ \('\^' \|\| id::text \|\| '\//);
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN/);
  });

  it("creates a private bucket limited to 5 MB of JPEG, PNG or WebP", () => {
    expect(sql).toMatch(/INSERT INTO storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\) VALUES \('trip-covers', 'trip-covers', false, 5242880, ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE SET public = false/);
    expect(sql).not.toMatch(/public\s*=\s*true|'trip-covers', 'trip-covers', true/);
  });

  it("recreates one policy per operation on the trip-covers bucket, for signed-in users only", () => {
    for (const [name, operation] of [
      ["trip_covers_select", "SELECT"],
      ["trip_covers_insert", "INSERT"],
      ["trip_covers_update", "UPDATE"],
      ["trip_covers_delete", "DELETE"],
    ]) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${name}" ON storage.objects;`);
      const body = policy(name);
      expect(body.startsWith(`FOR ${operation} TO authenticated`)).toBe(true);
      expect(body).toContain("bucket_id = 'trip-covers'");
    }
    expect(sql).not.toMatch(/TO anon/i);
  });

  it("decides access by the trip folder: members read, owner and editors write", () => {
    expect(sql).toContain("(storage.foldername(p_name))[1]");
    // The folder is only cast when it is a well-formed uuid, so a malformed name cannot throw.
    expect(sql).toMatch(/CASE WHEN v_folder ~ '\^\[0-9a-f\]\{8\}-/);
    expect(policy("trip_covers_select")).toContain("is_trip_member(trip_cover_trip_id(name), auth.uid())");
    for (const name of ["trip_covers_insert", "trip_covers_update", "trip_covers_delete"]) {
      expect(policy(name)).toContain("is_trip_owner(trip_cover_trip_id(name)) OR is_trip_editor(trip_cover_trip_id(name))");
    }
    expect(policy("trip_covers_insert")).toContain("trip_cover_name_ok(name)");
    expect(policy("trip_covers_update")).toContain("trip_cover_name_ok(name)");
  });

  it("lets owners and editors point the trip at an uploaded cover through a narrow function", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION set_trip_cover\(p_trip_id UUID, p_cover_path TEXT\) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/);
    expect(sql).toContain("NOT (is_trip_owner(p_trip_id) OR is_trip_editor(p_trip_id))");
    expect(sql).toContain("UPDATE trips SET cover_path = p_cover_path WHERE id = p_trip_id");
    expect(sql).toContain("REVOKE ALL ON FUNCTION set_trip_cover(UUID, TEXT) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION set_trip_cover(UUID, TEXT) TO authenticated;");
  });
});
