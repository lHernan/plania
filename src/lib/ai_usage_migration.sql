-- Daily AI quotas per registered user and route bucket (hand-run in the Supabase SQL Editor).
-- Idempotent: safe to run more than once.
--
-- Design:
-- * One row per (user, bucket, UTC day). Rows are written only by consume_ai_quota()
--   (SECURITY DEFINER); users have no INSERT/UPDATE/DELETE grant or policy, so they cannot
--   reset or inflate their own counter.
-- * The limits live here, inside the function, and the function takes no limit argument:
--   a client cannot ask for a bigger quota. src/lib/ai/quota.ts holds the same numbers
--   (AI_QUOTA_LIMITS); a test parses this file and fails if they drift apart.
-- * The user is always auth.uid() (the caller's JWT), never a client-supplied id.
-- * The day resets at 00:00 UTC.
-- * Old rows are tiny and harmless; optional cleanup, run by hand when wanted:
--     DELETE FROM public.ai_usage WHERE day < (now() AT TIME ZONE 'UTC')::date - 30;

CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  day DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket, day)
);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Users may read their own usage; there are deliberately no write policies.
DROP POLICY IF EXISTS "ai_usage_select_own" ON public.ai_usage;
CREATE POLICY "ai_usage_select_own" ON public.ai_usage FOR SELECT
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.ai_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ai_usage TO authenticated;

-- Counts one AI request for the caller in p_bucket and reports whether it is allowed.
-- At the limit it returns allowed = false WITHOUT incrementing.
CREATE OR REPLACE FUNCTION public.consume_ai_quota(p_bucket TEXT)
RETURNS TABLE(allowed BOOLEAN, used INTEGER, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_day DATE := (now() AT TIME ZONE 'UTC')::date;
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0;
    RETURN;
  END IF;

  -- Keep in sync with AI_QUOTA_LIMITS in src/lib/ai/quota.ts (a test compares them).
  v_limit := CASE p_bucket
    WHEN 'chat' THEN 100
    WHEN 'import' THEN 20
    WHEN 'bookings' THEN 30
    WHEN 'packing' THEN 20
    WHEN 'day_genius' THEN 20
    WHEN 'summary' THEN 10
    WHEN 'caption' THEN 50
    ELSE NULL
  END;
  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'unknown AI quota bucket: %', p_bucket USING ERRCODE = '22023';
  END IF;

  -- Atomic: concurrent calls serialize on the row; the WHERE guard never lets count pass the limit.
  INSERT INTO public.ai_usage AS u (user_id, bucket, day, count)
  VALUES (v_uid, p_bucket, v_day, 1)
  ON CONFLICT (user_id, bucket, day) DO UPDATE
    SET count = u.count + 1
    WHERE u.count < v_limit
  RETURNING u.count INTO v_count;

  IF v_count IS NULL THEN
    RETURN QUERY SELECT FALSE, v_limit, 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_count, v_limit - v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_quota(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_quota(TEXT) TO authenticated;
