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

  UPDATE trips               SET user_id = p_new_id WHERE user_id = p_anon_id;
  GET DIAGNOSTICS n = ROW_COUNT; total := total + n;

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
