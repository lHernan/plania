-- ============================================================
-- Migration: Persisted Travel Agent Chat
-- ============================================================
-- Run this in the Supabase SQL Editor after trip_shares_migration.sql.

-- Columns reserved for the map, budget, and planner phases.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS actual_cost NUMERIC;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS preferences JSONB;

CREATE TABLE IF NOT EXISTS trip_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL CHECK (char_length(content) <= 2000),
  actions     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trip_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trip_messages_trip_created
  ON trip_messages(trip_id, created_at);

-- Keep a small per-user/per-trip request window without storing prompt contents.
CREATE TABLE IF NOT EXISTS trip_chat_rate_limits (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id      UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trip_chat_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE trip_chat_rate_limits FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_trip_chat_rate_limits_window
  ON trip_chat_rate_limits(user_id, trip_id, requested_at DESC);

CREATE OR REPLACE FUNCTION public.consume_trip_chat_request(p_user_id UUID, p_trip_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  request_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT || ':' || p_trip_id::TEXT, 0));
  DELETE FROM public.trip_chat_rate_limits
  WHERE user_id = p_user_id
    AND trip_id = p_trip_id
    AND requested_at < NOW() - INTERVAL '5 minutes';

  SELECT COUNT(*) INTO request_count
  FROM public.trip_chat_rate_limits
  WHERE user_id = p_user_id
    AND trip_id = p_trip_id
    AND requested_at >= NOW() - INTERVAL '5 minutes';

  IF request_count >= 12 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.trip_chat_rate_limits(user_id, trip_id) VALUES (p_user_id, p_trip_id);
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_trip_chat_request(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_trip_chat_request(UUID, UUID) TO service_role;

DROP POLICY IF EXISTS "trip_messages_select" ON trip_messages;
CREATE POLICY "trip_messages_select" ON trip_messages FOR SELECT
  USING (
    is_trip_owner(trip_id)
    OR EXISTS (
      SELECT 1 FROM trip_shares
      WHERE trip_shares.trip_id = trip_messages.trip_id
        AND trip_shares.shared_with = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trip_messages_insert" ON trip_messages;
REVOKE INSERT, UPDATE, DELETE ON TABLE trip_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE trip_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE trip_messages TO service_role;
