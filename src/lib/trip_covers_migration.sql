-- ============================================================
-- Migration: User-uploaded trip covers
-- ============================================================
-- Run once in the Supabase SQL Editor, after trip_shares_migration.sql (is_trip_owner),
-- trip_shares_role_migration.sql (is_trip_editor) and packing_items_migration.sql
-- (is_trip_member). Additive and idempotent: safe to run again.
--
-- What it adds:
--   - trips.cover_path: the object path of the trip's cover, or NULL for the default
--     placeholder. It can only point inside the trip's own folder: '<trip id>/<uuid>.<ext>'.
--   - A PRIVATE storage bucket 'trip-covers' (5 MB, JPEG/PNG/WebP only). The app reads covers
--     with short-lived signed URLs, never public URLs.
--   - Storage policies keyed by the first folder of the object name (the trip id):
--       read   -> anyone on the trip (owner or any share, viewer or editor);
--       write  -> the trip owner and shared editors (upload, replace, delete).
--     Nothing is granted to the anon role.
--   - set_trip_cover(trip, path): lets the owner or an editor change only cover_path
--     (the trips UPDATE policy is owner-only) and returns the path it replaced.

-- 1. Column + format check (the CHECK also covers direct owner updates of the row).
ALTER TABLE trips ADD COLUMN IF NOT EXISTS cover_path TEXT;

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_cover_path_format;
ALTER TABLE trips ADD CONSTRAINT trips_cover_path_format CHECK (
  cover_path IS NULL
  OR cover_path ~ ('^' || id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
);

-- 2. Private bucket with size and type limits (re-running keeps it private and limited).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('trip-covers', 'trip-covers', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3. Helpers for the policies (no table access; plain SQL functions).
-- The trip id of an object name, or NULL when its first folder is not a well-formed uuid,
-- so a malformed name can never make a cast throw inside a policy.
CREATE OR REPLACE FUNCTION trip_cover_trip_id(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_folder TEXT := (storage.foldername(p_name))[1];
BEGIN
  RETURN CASE WHEN v_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_folder::uuid ELSE NULL END;
END;
$$;

-- Uploads must be exactly '<trip id>/<uuid>.<jpg|png|webp>' (no subfolders).
CREATE OR REPLACE FUNCTION trip_cover_name_ok(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$';
$$;

-- 4. Storage policies (signed-in users only; anonymous-auth guests use the authenticated role).
DROP POLICY IF EXISTS "trip_covers_select" ON storage.objects;
CREATE POLICY "trip_covers_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trip-covers'
    AND is_trip_member(trip_cover_trip_id(name), auth.uid())
  );

DROP POLICY IF EXISTS "trip_covers_insert" ON storage.objects;
CREATE POLICY "trip_covers_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'trip-covers'
    AND trip_cover_name_ok(name)
    AND (is_trip_owner(trip_cover_trip_id(name)) OR is_trip_editor(trip_cover_trip_id(name)))
  );

DROP POLICY IF EXISTS "trip_covers_update" ON storage.objects;
CREATE POLICY "trip_covers_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'trip-covers'
    AND (is_trip_owner(trip_cover_trip_id(name)) OR is_trip_editor(trip_cover_trip_id(name)))
  )
  WITH CHECK (
    bucket_id = 'trip-covers'
    AND trip_cover_name_ok(name)
    AND (is_trip_owner(trip_cover_trip_id(name)) OR is_trip_editor(trip_cover_trip_id(name)))
  );

DROP POLICY IF EXISTS "trip_covers_delete" ON storage.objects;
CREATE POLICY "trip_covers_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'trip-covers'
    AND (is_trip_owner(trip_cover_trip_id(name)) OR is_trip_editor(trip_cover_trip_id(name)))
  );

-- 5. Change only the cover of a trip the caller owns or edits. A new path must be an object
--    already uploaded to that trip's folder (the column CHECK pins the format).
CREATE OR REPLACE FUNCTION set_trip_cover(p_trip_id UUID, p_cover_path TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT (is_trip_owner(p_trip_id) OR is_trip_editor(p_trip_id)) THEN
    RAISE EXCEPTION 'not allowed to change this trip cover' USING ERRCODE = '42501';
  END IF;

  IF p_cover_path IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id = 'trip-covers' AND name = p_cover_path
  ) THEN
    RAISE EXCEPTION 'cover object not found' USING ERRCODE = '22023';
  END IF;

  SELECT cover_path INTO v_previous FROM trips WHERE id = p_trip_id FOR UPDATE;
  UPDATE trips SET cover_path = p_cover_path WHERE id = p_trip_id;
  RETURN v_previous;
END;
$$;

REVOKE ALL ON FUNCTION set_trip_cover(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_trip_cover(UUID, TEXT) TO authenticated;
