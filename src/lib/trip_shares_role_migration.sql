-- ============================================================
-- Migration: Trip Share Roles (viewer / editor)
-- ============================================================
-- Run this in the Supabase SQL Editor.
-- Adds a role column to trip_shares and grants editors write
-- access to the trip's child tables. Viewers keep read-only.

-- 1. Add role column (default viewer, backward compatible)
ALTER TABLE trip_shares
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer'
  CHECK (role IN ('viewer', 'editor'));

ALTER TABLE trip_shares
  ADD COLUMN IF NOT EXISTS invited_email TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trip_shares_role ON trip_shares(role);

-- 2. Helper: is the caller an editor of this trip?
CREATE OR REPLACE FUNCTION is_trip_editor(p_trip_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_shares
    WHERE trip_id = p_trip_id AND shared_with = auth.uid() AND role = 'editor'
  );
$$;

-- 3. Widen write policies on child tables to include editors.
--    Owners keep full control; editors can INSERT/UPDATE/DELETE.

-- TRIP DAYS
DROP POLICY IF EXISTS "trip_days_insert" ON trip_days;
CREATE POLICY "trip_days_insert" ON trip_days FOR INSERT
  WITH CHECK (auth.uid() = user_id OR is_trip_editor(trip_id));

DROP POLICY IF EXISTS "trip_days_update" ON trip_days;
CREATE POLICY "trip_days_update" ON trip_days FOR UPDATE
  USING (auth.uid() = user_id OR is_trip_editor(trip_id))
  WITH CHECK (auth.uid() = user_id OR is_trip_editor(trip_id));

DROP POLICY IF EXISTS "trip_days_delete" ON trip_days;
CREATE POLICY "trip_days_delete" ON trip_days FOR DELETE
  USING (auth.uid() = user_id OR is_trip_editor(trip_id));

-- ACTIVITIES
DROP POLICY IF EXISTS "activities_insert" ON activities;
CREATE POLICY "activities_insert" ON activities FOR INSERT
  WITH CHECK (auth.uid() = user_id OR is_trip_editor(trip_id));

DROP POLICY IF EXISTS "activities_update" ON activities;
CREATE POLICY "activities_update" ON activities FOR UPDATE
  USING (auth.uid() = user_id OR is_trip_editor(trip_id))
  WITH CHECK (auth.uid() = user_id OR is_trip_editor(trip_id));

DROP POLICY IF EXISTS "activities_delete" ON activities;
CREATE POLICY "activities_delete" ON activities FOR DELETE
  USING (auth.uid() = user_id OR is_trip_editor(trip_id));

-- CRITICAL RESERVATIONS
DROP POLICY IF EXISTS "reservations_insert" ON critical_reservations;
CREATE POLICY "reservations_insert" ON critical_reservations FOR INSERT
  WITH CHECK (auth.uid() = user_id OR is_trip_editor(trip_id));

DROP POLICY IF EXISTS "reservations_update" ON critical_reservations;
CREATE POLICY "reservations_update" ON critical_reservations FOR UPDATE
  USING (auth.uid() = user_id OR is_trip_editor(trip_id))
  WITH CHECK (auth.uid() = user_id OR is_trip_editor(trip_id));

DROP POLICY IF EXISTS "reservations_delete" ON critical_reservations;
CREATE POLICY "reservations_delete" ON critical_reservations FOR DELETE
  USING (auth.uid() = user_id OR is_trip_editor(trip_id));

-- NOTE: trips table itself stays owner-only for UPDATE/DELETE.
-- Editors edit child rows; trip metadata (name, dates) remains owner-controlled.
filePath">
D:\Dev\repos\plania\src\lib\trip_shares_role_migration.sql