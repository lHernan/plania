import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// SQL cannot run here: these checks pin the invariants of the hand-run migration as text.
const sql = readFileSync(path.resolve(__dirname, "../lib/expense_payers_migration.sql"), "utf8")
  .replace(/\s+/g, " ")
  .replace(/\( /g, "(")
  .replace(/ \)/g, ")");

const body = () => {
  const match = sql.match(/CREATE OR REPLACE FUNCTION save_expense\(p_expense JSONB, p_payers JSONB, p_splits JSONB\)(.*?)\$\$;/);
  expect(match).not.toBeNull();
  return match![1];
};

describe("expense_payers migration", () => {
  it("stores one row per payer in cents, never cascading an account deletion into the sums", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS expense_payers (");
    expect(sql).toContain("expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE");
    expect(sql).toContain("user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT");
    expect(sql).toContain("paid_cents BIGINT NOT NULL CHECK (paid_cents > 0)");
    expect(sql).toContain("PRIMARY KEY (expense_id, user_id)");
  });

  it("copies every existing payer before dropping paid_by, and only once", () => {
    const copy = sql.indexOf("INSERT INTO expense_payers (expense_id, user_id, paid_cents) SELECT id, paid_by, amount_cents FROM expenses ON CONFLICT (expense_id, user_id) DO NOTHING;");
    const drop = sql.indexOf("ALTER TABLE expenses DROP COLUMN paid_by;");
    expect(copy).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(copy);
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM information_schema\.columns WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'paid_by'\) THEN INSERT INTO expense_payers/);
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM expenses\b/);
  });

  it("lets members read payers like splits, with no write policies", () => {
    expect(sql).toContain("ALTER TABLE expense_payers ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain('CREATE POLICY "expense_payers_select" ON expense_payers FOR SELECT TO authenticated USING (can_see_expense(expense_id));');
    expect(sql).not.toMatch(/ON expense_payers FOR (INSERT|UPDATE|DELETE)/);
    expect(sql).not.toMatch(/TO anon\b/);
  });

  it("replaces the two-argument save_expense with one that takes the payers", () => {
    expect(sql).toContain("DROP FUNCTION IF EXISTS save_expense(JSONB, JSONB);");
    expect(sql).toContain("REVOKE ALL ON FUNCTION save_expense(JSONB, JSONB, JSONB) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION save_expense(JSONB, JSONB, JSONB) TO authenticated;");
    expect(body()).toContain("SECURITY DEFINER SET search_path = public");
  });

  it("validates the payers: positive, each once, adding up to the amount, members only", () => {
    const b = body();
    expect(b).toContain("count(*) FILTER (WHERE p.user_id IS NULL OR p.paid_cents IS NULL OR p.paid_cents <= 0)");
    expect(b).toContain("'save_expense: at least one payer with a positive amount is required'");
    expect(b).toContain("'save_expense: a person appears twice in the payers'");
    expect(b).toContain("IF v_sum IS DISTINCT FROM v_amount THEN RAISE EXCEPTION 'save_expense: the payers do not add up to the amount'");
    // A former member who already paid this expense may stay on an edit.
    expect(b).toContain(
      "WHERE NOT is_trip_member(v_trip, p.user_id) AND NOT (v_id IS NOT NULL AND EXISTS (SELECT 1 FROM expense_payers e WHERE e.expense_id = v_id AND e.user_id = p.user_id))"
    );
  });

  it("keeps the split, membership and edit rights checks", () => {
    const b = body();
    expect(b).toContain("IF v_trip IS NULL OR NOT is_trip_member(v_trip, auth.uid()) THEN RAISE EXCEPTION 'save_expense: not allowed' USING ERRCODE = '42501'");
    expect(b).toContain("IF NOT (v_existing.created_by = auth.uid() OR is_trip_owner(v_trip)) THEN");
    expect(b).toContain("'save_expense: the splits do not add up to the amount'");
    expect(b).toContain("'save_expense: percentages must add up to 100'");
    expect(b).toContain("'save_expense: a person in the splits is not a member of this trip'");
  });

  it("writes the expense without paid_by and replaces payers and splits together", () => {
    const b = body();
    expect(b).not.toContain("paid_by");
    expect(b).toContain("INSERT INTO expenses (trip_id, activity_id, title, amount_cents, currency, spent_on, category, split_method, notes, created_by)");
    expect(b).toContain("DELETE FROM expense_payers WHERE expense_id = v_id; DELETE FROM expense_splits WHERE expense_id = v_id;");
    expect(b).toContain("INSERT INTO expense_payers (expense_id, user_id, paid_cents) SELECT v_id, p.user_id, p.paid_cents FROM jsonb_to_recordset(p_payers)");
  });
});
