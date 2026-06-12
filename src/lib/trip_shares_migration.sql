-- ============================================================
-- Migration: Viajes Compartidos (Trip Shares)
-- ============================================================
-- Run this in the Supabase SQL Editor.

-- 1. Create trip_shares table
CREATE TABLE IF NOT EXISTS trip_shares (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  shared_with  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (trip_id, shared_with)
);

-- 2. Enable RLS
ALTER TABLE trip_shares ENABLE ROW LEVEL SECURITY;

-- 3. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_trip_shares_trip_id      ON trip_shares(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_shares_shared_with  ON trip_shares(shared_with);

-- 3.5 Helper function to break RLS recursion
CREATE OR REPLACE FUNCTION is_trip_owner(p_trip_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trips WHERE id = p_trip_id AND user_id = auth.uid()
  );
$$;

-- 4. RLS policies for trip_shares
--    - Owner of the trip can INSERT and DELETE shares
--    - Invitee can SELECT their own shares (to see which trips are shared with them)
DROP POLICY IF EXISTS "trip_shares_select" ON trip_shares;
CREATE POLICY "trip_shares_select" ON trip_shares FOR SELECT
  USING (
    shared_with = auth.uid()
    OR is_trip_owner(trip_id)
  );

DROP POLICY IF EXISTS "trip_shares_insert" ON trip_shares;
CREATE POLICY "trip_shares_insert" ON trip_shares FOR INSERT
  WITH CHECK (
    is_trip_owner(trip_id)
  );

DROP POLICY IF EXISTS "trip_shares_delete" ON trip_shares;
CREATE POLICY "trip_shares_delete" ON trip_shares FOR DELETE
  USING (
    is_trip_owner(trip_id)
  );

-- ============================================================
-- 5. Update existing RLS policies on trips and child tables
--    to allow shared users READ access.
--    We split the old "Unified" FOR ALL policy into per-operation
--    policies so owners can write and invitees can only read.
-- ============================================================

-- TRIPS
DROP POLICY IF EXISTS "Unified trips policy" ON trips;

DROP POLICY IF EXISTS "trips_select" ON trips;
CREATE POLICY "trips_select" ON trips FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM trip_shares WHERE trip_id = trips.id AND shared_with = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trips_insert" ON trips;
CREATE POLICY "trips_insert" ON trips FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "trips_update" ON trips;
CREATE POLICY "trips_update" ON trips FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "trips_delete" ON trips;
CREATE POLICY "trips_delete" ON trips FOR DELETE
  USING (auth.uid() = user_id);

-- TRIP DAYS
DROP POLICY IF EXISTS "Unified trip_days policy" ON trip_days;

DROP POLICY IF EXISTS "trip_days_select" ON trip_days;
CREATE POLICY "trip_days_select" ON trip_days FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM trip_shares WHERE trip_id = trip_days.trip_id AND shared_with = auth.uid()
    )
  );

DROP POLICY IF EXISTS "trip_days_insert" ON trip_days;
CREATE POLICY "trip_days_insert" ON trip_days FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "trip_days_update" ON trip_days;
CREATE POLICY "trip_days_update" ON trip_days FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "trip_days_delete" ON trip_days;
CREATE POLICY "trip_days_delete" ON trip_days FOR DELETE
  USING (auth.uid() = user_id);

-- ACTIVITIES
DROP POLICY IF EXISTS "Unified activities policy" ON activities;

DROP POLICY IF EXISTS "activities_select" ON activities;
CREATE POLICY "activities_select" ON activities FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM trip_shares WHERE trip_id = activities.trip_id AND shared_with = auth.uid()
    )
  );

DROP POLICY IF EXISTS "activities_insert" ON activities;
CREATE POLICY "activities_insert" ON activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "activities_update" ON activities;
CREATE POLICY "activities_update" ON activities FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "activities_delete" ON activities;
CREATE POLICY "activities_delete" ON activities FOR DELETE
  USING (auth.uid() = user_id);

-- CRITICAL RESERVATIONS
DROP POLICY IF EXISTS "Unified reservations policy" ON critical_reservations;

DROP POLICY IF EXISTS "reservations_select" ON critical_reservations;
CREATE POLICY "reservations_select" ON critical_reservations FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM trip_shares WHERE trip_id = critical_reservations.trip_id AND shared_with = auth.uid()
    )
  );

DROP POLICY IF EXISTS "reservations_insert" ON critical_reservations;
CREATE POLICY "reservations_insert" ON critical_reservations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reservations_update" ON critical_reservations;
CREATE POLICY "reservations_update" ON critical_reservations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "reservations_delete" ON critical_reservations;
CREATE POLICY "reservations_delete" ON critical_reservations FOR DELETE
  USING (auth.uid() = user_id);

-- ACTIVITY FILES
DROP POLICY IF EXISTS "Unified activity_files policy" ON activity_files;

DROP POLICY IF EXISTS "activity_files_select" ON activity_files;
CREATE POLICY "activity_files_select" ON activity_files FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM trip_shares WHERE trip_id = activity_files.trip_id AND shared_with = auth.uid()
    )
  );

DROP POLICY IF EXISTS "activity_files_insert" ON activity_files;
CREATE POLICY "activity_files_insert" ON activity_files FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "activity_files_update" ON activity_files;
CREATE POLICY "activity_files_update" ON activity_files FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "activity_files_delete" ON activity_files;
CREATE POLICY "activity_files_delete" ON activity_files FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 6. Helper function: get_trip_owner_email(trip_id UUID)
--    Used by the Edge Function to retrieve owner info.
--    Runs with SECURITY DEFINER so it can access auth.users.
-- ============================================================
CREATE OR REPLACE FUNCTION get_trip_owner_email(p_trip_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email
  FROM trips t
  JOIN auth.users u ON u.id = t.user_id
  WHERE t.id = p_trip_id
  LIMIT 1;
$$;
