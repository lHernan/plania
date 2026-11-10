-- ============================================================
-- Migration: Activity participants (who an activity is for)
-- ============================================================
-- Run once in the Supabase SQL Editor, after trip_shares_migration.sql (is_trip_owner),
-- trip_shares_role_migration.sql (is_trip_editor), packing_items_migration.sql (is_trip_member)
-- and trip_memories_migration.sql (trip_members). Then re-run transfer_anon_data.sql so a
-- guest's assignments move to the new account. Additive and idempotent: safe to run again.
--
-- What it adds:
--   - activity_participants: the trip members an activity is assigned to. An activity with no
--     rows is shared with every member (the default); with rows it belongs to those people only.
--     It is an itinerary filter, not privacy: every member still reads every activity, so the
--     activities policies are unchanged. Only the owner or an editor (who already write
--     activities) change assignments.
--   - set_activity_participants(activity, users): replaces the whole assignment in one call
--     (an empty array makes the activity shared again).
--   - trip_members(trip) also returns display_name and avatar_url (sign-in profile metadata),
--     for the avatars. The return type changes, so the function is dropped and recreated.
--   - Someone removed from a trip keeps their assignment rows: their flight stays theirs instead
--     of becoming shared with everyone. The app shows them as a former member.
-- Every policy applies to signed-in users only; nothing is granted to the anon role.

-- 1. Table ----------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activity_participants (
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Denormalized for the policies and the trip-wide load; the trigger below pins it to the activity's trip.
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_participants_trip ON activity_participants(trip_id);
CREATE INDEX IF NOT EXISTS idx_activity_participants_user ON activity_participants(user_id);

-- 2. Integrity trigger ----------------------------------------------------------------------

-- The trip always comes from the activity, and the person must be a member of that trip.
-- SECURITY DEFINER so the check never depends on what the caller may read.
CREATE OR REPLACE FUNCTION activity_participants_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip UUID;
BEGIN
  SELECT trip_id INTO v_trip FROM activities WHERE id = NEW.activity_id;
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'activity_participants: the activity does not exist' USING ERRCODE = '23503';
  END IF;
  NEW.trip_id := v_trip;
  IF NOT (
    EXISTS (SELECT 1 FROM trips WHERE id = v_trip AND user_id = NEW.user_id)
    OR EXISTS (SELECT 1 FROM trip_shares WHERE trip_id = v_trip AND shared_with = NEW.user_id)
  ) THEN
    RAISE EXCEPTION 'activity_participants: the person is not a member of this trip' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION activity_participants_before_write() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS activity_participants_before_write ON activity_participants;
CREATE TRIGGER activity_participants_before_write BEFORE INSERT OR UPDATE ON activity_participants
  FOR EACH ROW EXECUTE FUNCTION activity_participants_before_write();

-- 3. Row level security ---------------------------------------------------------------------

ALTER TABLE activity_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_participants_select" ON activity_participants;
CREATE POLICY "activity_participants_select" ON activity_participants FOR SELECT TO authenticated
  USING (is_trip_member(trip_id, auth.uid()));

DROP POLICY IF EXISTS "activity_participants_insert" ON activity_participants;
CREATE POLICY "activity_participants_insert" ON activity_participants FOR INSERT TO authenticated
  WITH CHECK (is_trip_owner(trip_id) OR is_trip_editor(trip_id));

DROP POLICY IF EXISTS "activity_participants_delete" ON activity_participants;
CREATE POLICY "activity_participants_delete" ON activity_participants FOR DELETE TO authenticated
  USING (is_trip_owner(trip_id) OR is_trip_editor(trip_id));

-- 4. Replace an assignment ------------------------------------------------------------------

-- SECURITY INVOKER: the policies above still apply; the explicit check turns a silent
-- zero-row delete into an error for someone who may not edit the trip.
CREATE OR REPLACE FUNCTION set_activity_participants(p_activity_id UUID, p_user_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_trip UUID;
  v_ids UUID[] := ARRAY(SELECT DISTINCT id FROM unnest(COALESCE(p_user_ids, '{}'::UUID[])) AS id WHERE id IS NOT NULL);
BEGIN
  SELECT trip_id INTO v_trip FROM activities WHERE id = p_activity_id;
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'set_activity_participants: activity not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (is_trip_owner(v_trip) OR is_trip_editor(v_trip)) THEN
    RAISE EXCEPTION 'set_activity_participants: not allowed' USING ERRCODE = '42501';
  END IF;
  DELETE FROM activity_participants WHERE activity_id = p_activity_id AND NOT (user_id = ANY(v_ids));
  -- Only the new ones: the trigger runs before ON CONFLICT, so re-sending a former member who is
  -- still assigned would fail its membership check.
  INSERT INTO activity_participants (activity_id, user_id, trip_id)
    SELECT p_activity_id, id, v_trip FROM unnest(v_ids) AS id
    WHERE NOT EXISTS (SELECT 1 FROM activity_participants p WHERE p.activity_id = p_activity_id AND p.user_id = id)
    ON CONFLICT (activity_id, user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION set_activity_participants(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_activity_participants(UUID, UUID[]) TO authenticated;

-- 5. Members with their profile -------------------------------------------------------------

-- The people of a trip (owner first, then every share) with their email, name and picture.
-- It only answers a current member of that trip; anyone else gets no rows.
DROP FUNCTION IF EXISTS trip_members(UUID);
CREATE OR REPLACE FUNCTION trip_members(p_trip_id UUID)
RETURNS TABLE (user_id UUID, email TEXT, is_owner BOOLEAN, display_name TEXT, avatar_url TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.user_id, u.email::text, true,
    COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
    COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
  FROM trips t
  JOIN auth.users u ON u.id = t.user_id
  WHERE t.id = p_trip_id AND is_trip_member(p_trip_id, auth.uid())
  UNION ALL
  SELECT s.shared_with, u.email::text, false,
    COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
    COALESCE(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
  FROM trip_shares s
  JOIN trips t ON t.id = s.trip_id
  JOIN auth.users u ON u.id = s.shared_with
  WHERE s.trip_id = p_trip_id
    AND s.shared_with IS DISTINCT FROM t.user_id
    AND is_trip_member(p_trip_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION trip_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION trip_members(UUID) TO authenticated;
