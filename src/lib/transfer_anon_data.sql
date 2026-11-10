-- ============================================================
-- Migration: Anonymous → Authenticated data transfer function
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Secure transfer function (SECURITY DEFINER bypasses RLS,
-- but the body enforces that only the caller's own new user_id
-- can be the target, and the source must be an anonymous user).
CREATE OR REPLACE FUNCTION transfer_anonymous_data(
  p_anon_id UUID,
  p_new_id  UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total INTEGER := 0;
  n     INTEGER;
BEGIN
  -- Security check 1: caller must be the receiving user
  IF auth.uid() IS DISTINCT FROM p_new_id THEN
    RAISE EXCEPTION 'Unauthorized: caller must be p_new_id';
  END IF;

  -- Security check 2: source must be an anonymous Supabase user
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = p_anon_id AND is_anonymous = TRUE
  ) THEN
    RETURN 0; -- nothing to transfer (or already transferred)
  END IF;

  -- Transfer in dependency order (children before parents for FK safety)
  UPDATE activities          SET user_id = p_new_id WHERE user_id = p_anon_id;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  UPDATE critical_reservations SET user_id = p_new_id WHERE user_id = p_anon_id;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  UPDATE trip_days           SET user_id = p_new_id WHERE user_id = p_anon_id;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  -- Packing lists (packing_items_migration.sql): only once that migration was applied.
  IF to_regclass('public.packing_items') IS NOT NULL THEN
    UPDATE packing_items SET owner_id = p_new_id WHERE owner_id = p_anon_id;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    UPDATE packing_items SET created_by = p_new_id WHERE created_by = p_anon_id;
    UPDATE packing_items SET assigned_to = p_new_id WHERE assigned_to = p_anon_id;
  END IF;

  -- Memories (trip_memories_migration.sql): only once that migration was applied. The flag
  -- lets the memories trigger accept this one author change, for this transaction only.
  -- memory_photos has no person column: photos follow their memory.
  IF to_regclass('public.memories') IS NOT NULL THEN
    PERFORM set_config('plania.memories_transfer', 'on', true);
    UPDATE memories SET author_id = p_new_id WHERE author_id = p_anon_id;
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    PERFORM set_config('plania.memories_transfer', 'off', true);
  END IF;
  IF to_regclass('public.memory_audience') IS NOT NULL THEN
    UPDATE memory_audience a SET user_id = p_new_id
    WHERE a.user_id = p_anon_id
      AND NOT EXISTS (SELECT 1 FROM memory_audience b WHERE b.memory_id = a.memory_id AND b.user_id = p_new_id);
    DELETE FROM memory_audience WHERE user_id = p_anon_id;
  END IF;

  UPDATE trips               SET user_id = p_new_id WHERE user_id = p_anon_id;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

  -- Activity assignments (activity_participants_migration.sql): after the trips move, because
  -- its trigger requires the new account to be a member of the trip already. Only on trips the
  -- new account belongs to (trip_shares rows of the guest do not move): the others are dropped,
  -- so the trigger can never fail the whole transfer.
  IF to_regclass('public.activity_participants') IS NOT NULL THEN
    UPDATE activity_participants a SET user_id = p_new_id
    WHERE a.user_id = p_anon_id
      AND (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = a.trip_id AND t.user_id = p_new_id)
        OR EXISTS (SELECT 1 FROM trip_shares s WHERE s.trip_id = a.trip_id AND s.shared_with = p_new_id)
      )
      AND NOT EXISTS (SELECT 1 FROM activity_participants b WHERE b.activity_id = a.activity_id AND b.user_id = p_new_id);
    DELETE FROM activity_participants WHERE user_id = p_anon_id;
  END IF;

  -- Expenses (trip_expenses_migration.sql): after the trips move, and only on trips the new
  -- account belongs to (trip_shares rows of the guest do not move). Money rows are never
  -- deleted: rows on other trips keep the guest id. The flag lets the expenses trigger accept
  -- this one creator change, for this transaction only.
  IF to_regclass('public.expenses') IS NOT NULL THEN
    PERFORM set_config('plania.expenses_transfer', 'on', true);
    UPDATE expenses e SET paid_by = p_new_id
    WHERE e.paid_by = p_anon_id
      AND (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = e.trip_id AND t.user_id = p_new_id)
        OR EXISTS (SELECT 1 FROM trip_shares s WHERE s.trip_id = e.trip_id AND s.shared_with = p_new_id)
      );
    GET DIAGNOSTICS n = ROW_COUNT; total := total + n;
    UPDATE expenses e SET created_by = p_new_id
    WHERE e.created_by = p_anon_id
      AND (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = e.trip_id AND t.user_id = p_new_id)
        OR EXISTS (SELECT 1 FROM trip_shares s WHERE s.trip_id = e.trip_id AND s.shared_with = p_new_id)
      );
    PERFORM set_config('plania.expenses_transfer', 'off', true);
  END IF;
  -- A split the new account already has on the same expense is kept; the guest's stays as is.
  IF to_regclass('public.expense_splits') IS NOT NULL THEN
    UPDATE expense_splits x SET user_id = p_new_id
    WHERE x.user_id = p_anon_id
      AND EXISTS (SELECT 1 FROM expenses e WHERE e.id = x.expense_id AND (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = e.trip_id AND t.user_id = p_new_id)
        OR EXISTS (SELECT 1 FROM trip_shares s WHERE s.trip_id = e.trip_id AND s.shared_with = p_new_id)
      ))
      AND NOT EXISTS (SELECT 1 FROM expense_splits b WHERE b.expense_id = x.expense_id AND b.user_id = p_new_id);
  END IF;
  -- Never a settlement from someone to themselves (that check would abort the transfer).
  IF to_regclass('public.expense_settlements') IS NOT NULL THEN
    UPDATE expense_settlements x SET from_user = p_new_id
    WHERE x.from_user = p_anon_id AND x.to_user <> p_new_id
      AND (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = x.trip_id AND t.user_id = p_new_id)
        OR EXISTS (SELECT 1 FROM trip_shares s WHERE s.trip_id = x.trip_id AND s.shared_with = p_new_id)
      );
    UPDATE expense_settlements x SET to_user = p_new_id
    WHERE x.to_user = p_anon_id AND x.from_user <> p_new_id
      AND (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = x.trip_id AND t.user_id = p_new_id)
        OR EXISTS (SELECT 1 FROM trip_shares s WHERE s.trip_id = x.trip_id AND s.shared_with = p_new_id)
      );
    UPDATE expense_settlements x SET created_by = p_new_id
    WHERE x.created_by = p_anon_id
      AND (
        EXISTS (SELECT 1 FROM trips t WHERE t.id = x.trip_id AND t.user_id = p_new_id)
        OR EXISTS (SELECT 1 FROM trip_shares s WHERE s.trip_id = x.trip_id AND s.shared_with = p_new_id)
      );
  END IF;

  RETURN total;
END;
$$;

-- Grant execute to authenticated users (anon users cannot call this
-- because auth.uid() check above requires them to be p_new_id,
-- which is a non-anonymous user UUID at call time)
GRANT EXECUTE ON FUNCTION transfer_anonymous_data(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_anonymous_data(UUID, UUID) TO anon;

-- ============================================================
-- ONE-TIME FIX: reassign your existing trips to your email account
-- Run ONLY if you already have trips created under an anonymous session.
-- ============================================================

-- Step 1 – Find your email account UUID:
-- SELECT id FROM auth.users WHERE email = 'hernan.laguado@gmail.com';

-- Step 2 – Replace YOUR_EMAIL_UUID below and run:
-- UPDATE trips                SET user_id = 'YOUR_EMAIL_UUID' WHERE user_id != 'YOUR_EMAIL_UUID';
-- UPDATE trip_days            SET user_id = 'YOUR_EMAIL_UUID' WHERE user_id != 'YOUR_EMAIL_UUID';
-- UPDATE activities           SET user_id = 'YOUR_EMAIL_UUID' WHERE user_id != 'YOUR_EMAIL_UUID';
-- UPDATE critical_reservations SET user_id = 'YOUR_EMAIL_UUID' WHERE user_id != 'YOUR_EMAIL_UUID';
