-- ============================================================
-- Migration: Expenses paid by several people
-- ============================================================
-- Run once in the Supabase SQL Editor, after trip_expenses_migration.sql. Then re-run
-- transfer_anon_data.sql (its old version still moves expenses.paid_by, which this drops).
-- Idempotent: safe to run again, and run it again whenever trip_expenses_migration.sql is re-run
-- (that file recreates the old two-argument save_expense).
--
-- What it changes:
--   - expense_payers: who paid an expense and how much each one paid, in cents. One row per
--     payer; the amounts always add up to the expense amount. It replaces expenses.paid_by.
--   - Every existing expense keeps its payer: one row with the whole amount, copied from
--     expenses.paid_by before that column is dropped.
--   - save_expense(expense, payers, splits): creates or edits an expense, its payers and its
--     splits in one atomic call. The old save_expense(expense, splits) is dropped.
--   - expense_payers is not published to realtime: save_expense always writes the expenses row
--     too, and that change already makes every member reload.
-- Payers follow the same rules as splits: members only, a former member already on the expense
-- may stay, ON DELETE RESTRICT so deleting an account never changes a trip's sums.

-- 1. Table ----------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expense_payers (
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  paid_cents BIGINT NOT NULL CHECK (paid_cents > 0),
  PRIMARY KEY (expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_payers_user ON expense_payers(user_id);

-- 2. Existing expenses ----------------------------------------------------------------------

-- Copy each single payer, then drop the column. Skipped once the column is gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'paid_by'
  ) THEN
    INSERT INTO expense_payers (expense_id, user_id, paid_cents)
      SELECT id, paid_by, amount_cents FROM expenses
      ON CONFLICT (expense_id, user_id) DO NOTHING;
    ALTER TABLE expenses DROP COLUMN paid_by;
  END IF;
END;
$$;

-- 3. Row level security ---------------------------------------------------------------------

-- Read like the splits; no write policies: writes go through save_expense.
ALTER TABLE expense_payers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_payers_select" ON expense_payers;
CREATE POLICY "expense_payers_select" ON expense_payers FOR SELECT TO authenticated
  USING (can_see_expense(expense_id));

-- 4. Saving an expense ----------------------------------------------------------------------

DROP FUNCTION IF EXISTS save_expense(JSONB, JSONB);

-- Creates (no id) or edits (id) one expense and replaces all its payers and splits in one
-- transaction.
-- p_expense: {id?, trip_id, activity_id, title, amount_cents, currency, spent_on, category,
--             split_method, notes}
-- p_payers:  [{user_id, paid_cents}, ...]
-- p_splits:  [{user_id, share_cents, percent_bp}, ...]
-- Errors: 42501 not allowed, 23514 invalid data, P0002 the expense to edit does not exist.
-- SECURITY DEFINER because the tables have no write policies; every rule is checked here.
CREATE OR REPLACE FUNCTION save_expense(p_expense JSONB, p_payers JSONB, p_splits JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID := NULLIF(p_expense->>'id', '')::uuid;
  v_trip UUID := NULLIF(p_expense->>'trip_id', '')::uuid;
  v_amount BIGINT := (p_expense->>'amount_cents')::bigint;
  v_method TEXT := p_expense->>'split_method';
  v_existing expenses%ROWTYPE;
  v_count INTEGER;
  v_distinct INTEGER;
  v_sum BIGINT;
  v_with_percent INTEGER;
  v_percent_sum BIGINT;
  v_bad_rows INTEGER;
BEGIN
  IF v_trip IS NULL OR NOT is_trip_member(v_trip, auth.uid()) THEN
    RAISE EXCEPTION 'save_expense: not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM expenses WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'save_expense: expense not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_existing.trip_id IS DISTINCT FROM v_trip THEN
      RAISE EXCEPTION 'save_expense: the trip of an expense cannot change' USING ERRCODE = '23514';
    END IF;
    IF NOT (v_existing.created_by = auth.uid() OR is_trip_owner(v_trip)) THEN
      RAISE EXCEPTION 'save_expense: not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_method IS NULL OR v_method NOT IN ('equal', 'exact', 'percent', 'individual') THEN
    RAISE EXCEPTION 'save_expense: unknown split method' USING ERRCODE = '23514';
  END IF;

  -- Payers: at least one, each once, every amount positive, adding up to the amount.
  IF jsonb_typeof(p_payers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'save_expense: payers must be an array' USING ERRCODE = '23514';
  END IF;

  SELECT count(*), count(DISTINCT p.user_id), sum(p.paid_cents),
    count(*) FILTER (WHERE p.user_id IS NULL OR p.paid_cents IS NULL OR p.paid_cents <= 0)
  INTO v_count, v_distinct, v_sum, v_bad_rows
  FROM jsonb_to_recordset(p_payers) AS p(user_id UUID, paid_cents BIGINT);

  IF v_count = 0 OR v_bad_rows > 0 THEN
    RAISE EXCEPTION 'save_expense: at least one payer with a positive amount is required' USING ERRCODE = '23514';
  END IF;
  IF v_distinct <> v_count THEN
    RAISE EXCEPTION 'save_expense: a person appears twice in the payers' USING ERRCODE = '23514';
  END IF;
  IF v_sum IS DISTINCT FROM v_amount THEN
    RAISE EXCEPTION 'save_expense: the payers do not add up to the amount' USING ERRCODE = '23514';
  END IF;

  -- New payers must be members; a former member who already paid this expense may stay.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_payers) AS p(user_id UUID, paid_cents BIGINT)
    WHERE NOT is_trip_member(v_trip, p.user_id)
      AND NOT (v_id IS NOT NULL AND EXISTS (SELECT 1 FROM expense_payers e WHERE e.expense_id = v_id AND e.user_id = p.user_id))
  ) THEN
    RAISE EXCEPTION 'save_expense: the payer is not a member of this trip' USING ERRCODE = '23514';
  END IF;

  -- Splits.
  IF jsonb_typeof(p_splits) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'save_expense: splits must be an array' USING ERRCODE = '23514';
  END IF;

  SELECT count(*), count(DISTINCT s.user_id), sum(s.share_cents), count(s.percent_bp), COALESCE(sum(s.percent_bp), 0),
    count(*) FILTER (WHERE s.user_id IS NULL OR s.share_cents IS NULL)
  INTO v_count, v_distinct, v_sum, v_with_percent, v_percent_sum, v_bad_rows
  FROM jsonb_to_recordset(p_splits) AS s(user_id UUID, share_cents BIGINT, percent_bp INTEGER);

  IF v_count = 0 OR v_bad_rows > 0 THEN
    RAISE EXCEPTION 'save_expense: at least one complete split is required' USING ERRCODE = '23514';
  END IF;
  IF v_distinct <> v_count THEN
    RAISE EXCEPTION 'save_expense: a person appears twice in the splits' USING ERRCODE = '23514';
  END IF;
  IF v_sum IS DISTINCT FROM v_amount THEN
    RAISE EXCEPTION 'save_expense: the splits do not add up to the amount' USING ERRCODE = '23514';
  END IF;
  IF v_method = 'individual' AND v_count <> 1 THEN
    RAISE EXCEPTION 'save_expense: an individual expense has exactly one person' USING ERRCODE = '23514';
  END IF;
  IF v_method = 'percent' AND (v_with_percent <> v_count OR v_percent_sum <> 10000) THEN
    RAISE EXCEPTION 'save_expense: percentages must add up to 100' USING ERRCODE = '23514';
  END IF;

  -- New split users must be members; a former member already on this expense may stay.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_splits) AS s(user_id UUID, share_cents BIGINT, percent_bp INTEGER)
    WHERE NOT is_trip_member(v_trip, s.user_id)
      AND NOT (v_id IS NOT NULL AND EXISTS (SELECT 1 FROM expense_splits e WHERE e.expense_id = v_id AND e.user_id = s.user_id))
  ) THEN
    RAISE EXCEPTION 'save_expense: a person in the splits is not a member of this trip' USING ERRCODE = '23514';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO expenses (trip_id, activity_id, title, amount_cents, currency, spent_on, category, split_method, notes, created_by)
    VALUES (
      v_trip,
      NULLIF(p_expense->>'activity_id', '')::uuid,
      p_expense->>'title',
      v_amount,
      p_expense->>'currency',
      (p_expense->>'spent_on')::date,
      p_expense->>'category',
      v_method,
      NULLIF(p_expense->>'notes', ''),
      auth.uid()
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE expenses SET
      activity_id = NULLIF(p_expense->>'activity_id', '')::uuid,
      title = p_expense->>'title',
      amount_cents = v_amount,
      currency = p_expense->>'currency',
      spent_on = (p_expense->>'spent_on')::date,
      category = p_expense->>'category',
      split_method = v_method,
      notes = NULLIF(p_expense->>'notes', '')
    WHERE id = v_id;
    DELETE FROM expense_payers WHERE expense_id = v_id;
    DELETE FROM expense_splits WHERE expense_id = v_id;
  END IF;

  INSERT INTO expense_payers (expense_id, user_id, paid_cents)
    SELECT v_id, p.user_id, p.paid_cents
    FROM jsonb_to_recordset(p_payers) AS p(user_id UUID, paid_cents BIGINT);

  INSERT INTO expense_splits (expense_id, user_id, share_cents, percent_bp)
    SELECT v_id, s.user_id, s.share_cents, CASE WHEN v_method = 'percent' THEN s.percent_bp END
    FROM jsonb_to_recordset(p_splits) AS s(user_id UUID, share_cents BIGINT, percent_bp INTEGER);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION save_expense(JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_expense(JSONB, JSONB, JSONB) TO authenticated;
