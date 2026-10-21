-- ============================================================
-- Migration: Allow reading trips via a valid share link
-- ============================================================
-- Run this in the Supabase SQL Editor.
-- Lets anyone (including anonymous visitors) read a trip and its
-- days/activities when there is at least one non-revoked,
-- non-expired share link for it. The share link token (in the URL)
-- is the secret that gates access.

DROP POLICY IF EXISTS "trips_select_via_share_link" ON trips;
CREATE POLICY "trips_select_via_share_link" ON trips FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM trip_share_links
    WHERE trip_id = trips.id
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  )
);

DROP POLICY IF EXISTS "trip_days_select_via_share_link" ON trip_days;
CREATE POLICY "trip_days_select_via_share_link" ON trip_days FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM trip_share_links
    WHERE trip_id = trip_days.trip_id
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  )
);

DROP POLICY IF EXISTS "activities_select_via_share_link" ON activities;
CREATE POLICY "activities_select_via_share_link" ON activities FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM trip_share_links
    WHERE trip_id = activities.trip_id
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  )
);

DROP POLICY IF EXISTS "reservations_select_via_share_link" ON critical_reservations;
CREATE POLICY "reservations_select_via_share_link" ON critical_reservations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM trip_share_links
    WHERE trip_id = critical_reservations.trip_id
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  )
);
filePath">
D:\Dev\repos\plania\src\lib\trip_share_public_read_migration.sql