-- ============================================================
-- Migration (superseded): reading trips via a share link
-- ============================================================
-- This migration used to let ANY caller (every signed-in user and anonymous visitors) read a
-- trip, its days, activities and critical reservations while the trip had an active share
-- link. That is no longer allowed: share link tokens are checked only on the server, see
-- trip_share_link_access_migration.sql.
--
-- Kept so that re-running it is harmless: it only removes the old policies.

DROP POLICY IF EXISTS "trips_select_via_share_link" ON trips;
DROP POLICY IF EXISTS "trip_days_select_via_share_link" ON trip_days;
DROP POLICY IF EXISTS "activities_select_via_share_link" ON activities;
DROP POLICY IF EXISTS "reservations_select_via_share_link" ON critical_reservations;
