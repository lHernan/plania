import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AI_QUOTA_LIMITS } from "@/lib/ai/quota";

// SQL cannot run here: these checks pin the invariants of the hand-run migration as text (S1, S3).
const raw = readFileSync(path.resolve(__dirname, "../lib/ai_usage_migration.sql"), "utf8");
// Comments stripped so documentation never satisfies (or breaks) a check.
const sql = raw.replace(/--.*$/gm, "").replace(/\s+/g, " ");

describe("ai_usage migration", () => {
  it("creates the usage table idempotently with one row per user, bucket and day", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ai_usage");
    expect(sql).toContain("user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(sql).toContain("count INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain("PRIMARY KEY (user_id, bucket, day)");
    expect(sql).not.toMatch(/DROP TABLE/);
  });

  it("enables RLS with no write policy and no write grant for users", () => {
    expect(sql).toContain("ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;");
    const policies = [...sql.matchAll(/CREATE POLICY "[^"]+" ON public\.ai_usage FOR (\w+)/g)].map((m) => m[1]);
    expect(policies).toEqual(["SELECT"]);
    expect(sql).toContain("USING (user_id = auth.uid())");
    expect(sql).toContain("REVOKE ALL ON TABLE public.ai_usage FROM PUBLIC, anon, authenticated;");
    expect(sql).not.toMatch(/GRANT [^;]*(INSERT|UPDATE|DELETE)[^;]*ON TABLE public\.ai_usage/);
  });

  it("counts through a SECURITY DEFINER function that only authenticated users may run", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_bucket TEXT)");
    expect(sql).toContain("RETURNS TABLE(allowed BOOLEAN, used INTEGER, remaining INTEGER)");
    expect(sql).toContain("SECURITY DEFINER SET search_path = public");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.consume_ai_quota(TEXT) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.consume_ai_quota(TEXT) TO authenticated;");
  });

  it("uses auth.uid() (never a client-supplied user) and denies without a user", () => {
    expect(sql).toContain("v_uid UUID := auth.uid();");
    expect(sql).not.toMatch(/p_user_id/);
    expect(sql).toMatch(/IF v_uid IS NULL THEN RETURN QUERY SELECT FALSE, 0, 0;/);
  });

  it("increments atomically per UTC day and never past the limit", () => {
    expect(sql).toContain("v_day DATE := (now() AT TIME ZONE 'UTC')::date;");
    expect(sql).toContain(
      "ON CONFLICT (user_id, bucket, day) DO UPDATE SET count = u.count + 1 WHERE u.count < v_limit RETURNING u.count INTO v_count;",
    );
    expect(sql).toMatch(/IF v_count IS NULL THEN RETURN QUERY SELECT FALSE, v_limit, 0;/);
  });

  it("rejects unknown buckets", () => {
    expect(sql).toMatch(/ELSE NULL END; IF v_limit IS NULL THEN RAISE EXCEPTION/);
  });

  it("holds exactly the same bucket limits as AI_QUOTA_LIMITS", () => {
    const inSql = Object.fromEntries([...sql.matchAll(/WHEN '(\w+)' THEN (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(inSql).toEqual(AI_QUOTA_LIMITS);
    expect(AI_QUOTA_LIMITS).toEqual({ chat: 100, import: 20, bookings: 30, packing: 20, day_genius: 20, summary: 10, caption: 50 });
  });
});
