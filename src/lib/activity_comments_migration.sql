-- ============================================================
-- Migration: Activity Comments (collaboration)
-- ============================================================
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS activity_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id  UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  trip_id      UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE activity_comments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_activity_comments_activity ON activity_comments(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_comments_trip ON activity_comments(trip_id);

-- Anyone who can read the trip can read its comments.
DROP POLICY IF EXISTS "activity_comments_select" ON activity_comments;
CREATE POLICY "activity_comments_select" ON activity_comments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = activity_comments.trip_id
      AND (
        t.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM trip_shares ts WHERE ts.trip_id = t.id AND ts.shared_with = auth.uid())
        OR EXISTS (SELECT 1 FROM trip_share_links tsl WHERE tsl.trip_id = t.id AND tsl.revoked_at IS NULL AND (tsl.expires_at IS NULL OR tsl.expires_at > now()))
      )
  )
);

-- Owner and editors can insert comments.
DROP POLICY IF EXISTS "activity_comments_insert" ON activity_comments;
CREATE POLICY "activity_comments_insert" ON activity_comments FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = activity_comments.trip_id
      AND (
        t.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM trip_shares ts WHERE ts.trip_id = t.id AND ts.shared_with = auth.uid() AND ts.role = 'editor')
        OR EXISTS (SELECT 1 FROM trip_share_links tsl WHERE tsl.trip_id = t.id AND tsl.role = 'editor' AND tsl.revoked_at IS NULL AND (tsl.expires_at IS NULL OR tsl.expires_at > now()))
      )
  )
);

-- Only the author can delete their own comment.
DROP POLICY IF EXISTS "activity_comments_delete" ON activity_comments;
CREATE POLICY "activity_comments_delete" ON activity_comments FOR DELETE
USING (auth.uid() = user_id);
filePath">
D:\Dev\repos\plania\src\lib\activity_comments_migration.sql