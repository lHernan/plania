-- ============================================================
-- Migration: Share links no longer grant database reads
-- ============================================================
-- Run this in the Supabase SQL Editor. Idempotent: safe to run more than once.
--
-- Before: while a trip had any active share link, RLS let ANY caller (every signed-in user,
-- and anonymous visitors) read the trip, its days, activities and critical reservations,
-- and list every share link (with its token) of every trip. Activity comments could also be
-- read, and inserted when the link was an editor link, by anyone signed in.
--
-- After: a share link token is checked only on the server. The public routes
-- GET /api/share/[token] and GET /api/share/[token]/trip validate the token (exists, not revoked,
-- not expired) with the service role client and return the read-only preview themselves;
-- they no longer fall back to the anon key. Accepting a link (POST /api/share/[token]/accept)
-- and claiming invitations already use the service role. In the database, a signed-in user
-- reads a trip only as its owner or as a trip_shares member (the existing owner/member
-- policies, which this migration does not touch). The owner still manages their own links
-- through "trip_share_links_owner_all".
--
-- No SECURITY DEFINER function is added: the token path is the server route with the service
-- role, so nothing new is granted to anon or authenticated.

-- 1) Link-based reads of the trip and its plan (from trip_share_public_read_migration.sql).
DROP POLICY IF EXISTS "trips_select_via_share_link" ON trips;
DROP POLICY IF EXISTS "trip_days_select_via_share_link" ON trip_days;
DROP POLICY IF EXISTS "activities_select_via_share_link" ON activities;
DROP POLICY IF EXISTS "reservations_select_via_share_link" ON critical_reservations;

-- 2) "USING (true)" on the links table let anyone list every token (from trip_share_links_migration.sql).
DROP POLICY IF EXISTS "trip_share_links_select_by_token" ON trip_share_links;

-- 3) Activity comments: same rules as before, without the share-link branch.
DROP POLICY IF EXISTS "activity_comments_select" ON activity_comments;
CREATE POLICY "activity_comments_select" ON activity_comments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = activity_comments.trip_id
      AND (
        t.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM trip_shares ts WHERE ts.trip_id = t.id AND ts.shared_with = auth.uid())
      )
  )
);

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
      )
  )
);
