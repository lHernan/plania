-- ============================================================
-- Migration: Trip expenses (shared costs, splits and settlements)
-- ============================================================
-- Run once in the Supabase SQL Editor, after trip_shares_migration.sql (is_trip_owner),
-- trip_shares_role_migration.sql (is_trip_editor) and packing_items_migration.sql
-- (is_trip_member). Then re-run transfer_anon_data.sql so a guest's expenses move to the new
-- account. Additive and idempotent: safe to run again.
--
-- What it adds:
--   - expenses: one cost of a trip in minor units (cents) of one currency, optionally about one
--     activity of that same trip, paid by one member and split with a method
--     ('equal', 'exact', 'percent', 'individual').
--   - expense_splits: what each person owes of an expense (share_cents, and percent_bp in basis
--     points for 'percent'). The shares always add up to the expense amount.
--   - save_expense(expense, splits): the ONLY way to create or edit an expense and its splits,
--     in one atomic call that checks membership, sums and method rules. There are no INSERT or
--     UPDATE policies on these two tables.
--   - set_expense_receipt(expense, path): attach or clear the receipt photo, stored at
--     '<trip id>/<expense id>/<uuid>.<ext>' in the PRIVATE bucket 'trip-receipts'
--     (10 MB, JPEG/PNG/WebP).
--   - expense_settlements: payments recorded between two members to settle debts (history).
--   - The three tables join the supabase_realtime publication for live collaboration.
-- Any member (owner, editor or viewer) reads and records expenses and settlements; only the
-- creator or the trip owner edits or deletes them, and only while still a member.
-- People columns of money rows (paid_by, split user_id, settlement users, created_by) use
-- ON DELETE RESTRICT: deleting an account can never silently change a trip's sums. Someone
-- removed from a trip keeps their rows; an edit may keep them but never add a non-member.
-- Every policy applies to signed-in users only (anonymous-auth guests use the authenticated
-- role); nothing is granted to the anon role.

-- 1. Tables ---------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  spent_on DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('flights', 'lodging', 'transport', 'food', 'activities', 'shopping', 'other')),
  paid_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  split_method TEXT NOT NULL CHECK (split_method IN ('equal', 'exact', 'percent', 'individual')),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 2000),
  receipt_path TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The receipt always lives in the folder of its own trip and expense.
  CONSTRAINT expenses_receipt_path_format CHECK (
    receipt_path IS NULL
    OR receipt_path ~ ('^' || trip_id::text || '/' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
  )
);

CREATE INDEX IF NOT EXISTS idx_expenses_trip_spent_on ON expenses(trip_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_activity ON expenses(activity_id);

-- The foreign key on expense_id lets the app embed splits: expenses?select=*,expense_splits(...)
CREATE TABLE IF NOT EXISTS expense_splits (
  expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  share_cents BIGINT NOT NULL CHECK (share_cents >= 0),
  percent_bp INTEGER CHECK (percent_bp IS NULL OR percent_bp BETWEEN 0 AND 10000),
  PRIMARY KEY (expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_expense_splits_user ON expense_splits(user_id);

CREATE TABLE IF NOT EXISTS expense_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  to_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  settled_on DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expense_settlements_two_people CHECK (from_user <> to_user)
);

CREATE INDEX IF NOT EXISTS idx_expense_settlements_trip_settled_on ON expense_settlements(trip_id, settled_on DESC);

-- 2. Integrity triggers ---------------------------------------------------------------------

-- An expense's activity must belong to the expense's trip. SECURITY DEFINER so the check never
-- depends on what the caller may read.
CREATE OR REPLACE FUNCTION expenses_check_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM activities WHERE id = NEW.activity_id AND trip_id = NEW.trip_id
  ) THEN
    RAISE EXCEPTION 'expenses: the activity does not belong to this trip' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION expenses_check_activity() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS expenses_check_activity ON expenses;
CREATE TRIGGER expenses_check_activity BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_check_activity();

-- updated_at, and an expense never moves to another trip or changes creator. The only exception
-- is transfer_anonymous_data (transfer_anon_data.sql), which moves a guest's expenses to the
-- account they sign up with and flags it for its own transaction.
CREATE OR REPLACE FUNCTION expenses_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id THEN
    RAISE EXCEPTION 'expenses: trip_id cannot change';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
    AND current_setting('plania.expenses_transfer', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'expenses: created_by cannot change';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS expenses_before_update ON expenses;
CREATE TRIGGER expenses_before_update BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_before_update();

-- A settlement is always between two members of its trip. Only on INSERT (settlements are never
-- edited), so moving a guest's rows in transfer_anonymous_data never runs into it.
CREATE OR REPLACE FUNCTION expense_settlements_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM trips WHERE id = NEW.trip_id AND user_id = NEW.from_user)
    OR EXISTS (SELECT 1 FROM trip_shares WHERE trip_id = NEW.trip_id AND shared_with = NEW.from_user)
  ) OR NOT (
    EXISTS (SELECT 1 FROM trips WHERE id = NEW.trip_id AND user_id = NEW.to_user)
    OR EXISTS (SELECT 1 FROM trip_shares WHERE trip_id = NEW.trip_id AND shared_with = NEW.to_user)
  ) THEN
    RAISE EXCEPTION 'expense_settlements: both people must be members of this trip' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION expense_settlements_before_insert() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS expense_settlements_before_insert ON expense_settlements;
CREATE TRIGGER expense_settlements_before_insert BEFORE INSERT ON expense_settlements
  FOR EACH ROW EXECUTE FUNCTION expense_settlements_before_insert();

-- 3. Helpers --------------------------------------------------------------------------------

-- May the caller see this expense (and so its splits)? Only a current member of its trip.
CREATE OR REPLACE FUNCTION can_see_expense(p_expense_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM expenses e
    WHERE e.id = p_expense_id AND is_trip_member(e.trip_id, auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION can_see_expense(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_see_expense(UUID) TO authenticated;

-- 4. Saving an expense ----------------------------------------------------------------------

-- Creates (no id) or edits (id) one expense and replaces all its splits in one transaction.
-- p_expense: {id?, trip_id, activity_id, title, amount_cents, currency, spent_on, category,
--             paid_by, split_method, notes}
-- p_splits:  [{user_id, share_cents, percent_bp}, ...]
-- Errors: 42501 not allowed, 23514 invalid data, P0002 the expense to edit does not exist.
-- SECURITY DEFINER because the tables have no write policies; every rule is checked here.
CREATE OR REPLACE FUNCTION save_expense(p_expense JSONB, p_splits JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID := NULLIF(p_expense->>'id', '')::uuid;
  v_trip UUID := NULLIF(p_expense->>'trip_id', '')::uuid;
  v_paid_by UUID := NULLIF(p_expense->>'paid_by', '')::uuid;
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

  -- The payer must be a member; an edit may keep a former member who already paid it.
  IF v_paid_by IS NULL OR (
    NOT is_trip_member(v_trip, v_paid_by)
    AND (v_id IS NULL OR v_paid_by IS DISTINCT FROM v_existing.paid_by)
  ) THEN
    RAISE EXCEPTION 'save_expense: the payer is not a member of this trip' USING ERRCODE = '23514';
  END IF;

  IF v_method IS NULL OR v_method NOT IN ('equal', 'exact', 'percent', 'individual') THEN
    RAISE EXCEPTION 'save_expense: unknown split method' USING ERRCODE = '23514';
  END IF;

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
    INSERT INTO expenses (trip_id, activity_id, title, amount_cents, currency, spent_on, category, paid_by, split_method, notes, created_by)
    VALUES (
      v_trip,
      NULLIF(p_expense->>'activity_id', '')::uuid,
      p_expense->>'title',
      v_amount,
      p_expense->>'currency',
      (p_expense->>'spent_on')::date,
      p_expense->>'category',
      v_paid_by,
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
      paid_by = v_paid_by,
      split_method = v_method,
      notes = NULLIF(p_expense->>'notes', '')
    WHERE id = v_id;
    DELETE FROM expense_splits WHERE expense_id = v_id;
  END IF;

  INSERT INTO expense_splits (expense_id, user_id, share_cents, percent_bp)
    SELECT v_id, s.user_id, s.share_cents, CASE WHEN v_method = 'percent' THEN s.percent_bp END
    FROM jsonb_to_recordset(p_splits) AS s(user_id UUID, share_cents BIGINT, percent_bp INTEGER);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION save_expense(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION save_expense(JSONB, JSONB) TO authenticated;

-- Attaches (path) or clears (NULL) the receipt of an expense. Only its creator or the trip
-- owner, while still a member; the path must be in the expense's own folder.
CREATE OR REPLACE FUNCTION set_expense_receipt(p_expense_id UUID, p_path TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense expenses%ROWTYPE;
BEGIN
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_expense_receipt: expense not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (is_trip_member(v_expense.trip_id, auth.uid()) AND (v_expense.created_by = auth.uid() OR is_trip_owner(v_expense.trip_id))) THEN
    RAISE EXCEPTION 'set_expense_receipt: not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_path IS NOT NULL AND p_path !~ ('^' || v_expense.trip_id::text || '/' || v_expense.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') THEN
    RAISE EXCEPTION 'set_expense_receipt: invalid receipt path' USING ERRCODE = '23514';
  END IF;
  UPDATE expenses SET receipt_path = p_path WHERE id = p_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION set_expense_receipt(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_expense_receipt(UUID, TEXT) TO authenticated;

-- 5. Row level security ---------------------------------------------------------------------

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_settlements ENABLE ROW LEVEL SECURITY;

-- No INSERT or UPDATE policies on expenses or expense_splits: writes go through save_expense
-- and set_expense_receipt. Deleting an expense cascades to its splits.
DROP POLICY IF EXISTS "expenses_select" ON expenses;
CREATE POLICY "expenses_select" ON expenses FOR SELECT TO authenticated
  USING (is_trip_member(trip_id, auth.uid()));

DROP POLICY IF EXISTS "expenses_delete" ON expenses;
CREATE POLICY "expenses_delete" ON expenses FOR DELETE TO authenticated
  USING ((created_by = auth.uid() OR is_trip_owner(trip_id)) AND is_trip_member(trip_id, auth.uid()));

DROP POLICY IF EXISTS "expense_splits_select" ON expense_splits;
CREATE POLICY "expense_splits_select" ON expense_splits FOR SELECT TO authenticated
  USING (can_see_expense(expense_id));

-- Settlements are history: recorded and deleted, never edited.
DROP POLICY IF EXISTS "expense_settlements_select" ON expense_settlements;
CREATE POLICY "expense_settlements_select" ON expense_settlements FOR SELECT TO authenticated
  USING (is_trip_member(trip_id, auth.uid()));

DROP POLICY IF EXISTS "expense_settlements_insert" ON expense_settlements;
CREATE POLICY "expense_settlements_insert" ON expense_settlements FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND is_trip_member(trip_id, auth.uid()));

DROP POLICY IF EXISTS "expense_settlements_delete" ON expense_settlements;
CREATE POLICY "expense_settlements_delete" ON expense_settlements FOR DELETE TO authenticated
  USING ((created_by = auth.uid() OR is_trip_owner(trip_id)) AND is_trip_member(trip_id, auth.uid()));

-- 6. Storage --------------------------------------------------------------------------------

-- Private bucket with size and type limits (re-running keeps it private and limited).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('trip-receipts', 'trip-receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- May the caller read this object? Any current member of the trip in the first folder. The
-- name is checked before any cast, so a malformed name can never make a policy throw.
CREATE OR REPLACE FUNCTION can_read_expense_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid CONSTANT TEXT := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_folders TEXT[];
BEGIN
  IF p_name IS NULL OR p_name !~ ('^' || v_uuid || '/' || v_uuid || '/' || v_uuid || '\.(jpg|png|webp)$') THEN
    RETURN false;
  END IF;
  v_folders := storage.foldername(p_name);
  RETURN is_trip_member(v_folders[1]::uuid, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION can_read_expense_object(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_read_expense_object(TEXT) TO authenticated;

-- May the caller write this object? Only an object named exactly
-- '<trip id>/<expense id>/<uuid>.<jpg|png|webp>' whose expense belongs to that trip and was
-- created by the caller or belongs to a trip the caller owns, while still a member.
CREATE OR REPLACE FUNCTION can_write_expense_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid CONSTANT TEXT := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_folders TEXT[];
BEGIN
  IF p_name IS NULL OR p_name !~ ('^' || v_uuid || '/' || v_uuid || '/' || v_uuid || '\.(jpg|png|webp)$') THEN
    RETURN false;
  END IF;
  v_folders := storage.foldername(p_name);
  RETURN EXISTS (
    SELECT 1 FROM expenses e
    WHERE e.id = v_folders[2]::uuid AND e.trip_id = v_folders[1]::uuid
      AND (e.created_by = auth.uid() OR is_trip_owner(e.trip_id)) AND is_trip_member(e.trip_id, auth.uid())
  );
END;
$$;

REVOKE ALL ON FUNCTION can_write_expense_object(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_write_expense_object(TEXT) TO authenticated;

DROP POLICY IF EXISTS "trip_receipts_select" ON storage.objects;
CREATE POLICY "trip_receipts_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trip-receipts'
    AND can_read_expense_object(name)
  );

DROP POLICY IF EXISTS "trip_receipts_insert" ON storage.objects;
CREATE POLICY "trip_receipts_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'trip-receipts'
    AND can_write_expense_object(name)
  );

DROP POLICY IF EXISTS "trip_receipts_update" ON storage.objects;
CREATE POLICY "trip_receipts_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'trip-receipts'
    AND can_write_expense_object(name)
  )
  WITH CHECK (
    bucket_id = 'trip-receipts'
    AND can_write_expense_object(name)
  );

DROP POLICY IF EXISTS "trip_receipts_delete" ON storage.objects;
CREATE POLICY "trip_receipts_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'trip-receipts'
    AND can_write_expense_object(name)
  );

-- 7. Realtime -------------------------------------------------------------------------------

-- Publish the three tables once; skip silently where the publication does not exist.
DO $$
DECLARE
  v_table TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;
  FOREACH v_table IN ARRAY ARRAY['expenses', 'expense_splits', 'expense_settlements'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;
