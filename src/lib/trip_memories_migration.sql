-- ============================================================
-- Migration: Trip memories (photos, note and rating per trip or activity)
-- ============================================================
-- Run once in the Supabase SQL Editor, after trip_shares_migration.sql (is_trip_owner),
-- trip_shares_role_migration.sql (is_trip_editor), packing_items_migration.sql (is_trip_member)
-- and trip_covers_migration.sql. Then re-run transfer_anon_data.sql so a guest's memories move
-- to the new account. Additive and idempotent: safe to run again.
--
-- What it adds:
--   - memories: one memory of a trip, optionally about one activity of that same trip, with a
--     note, a 1-5 rating and an audience:
--       'trip'     -> every current member of the trip (owner or any share) sees it;
--       'selected' -> only the author and the members listed in memory_audience see it.
--     Any member (owner, editor or viewer) can create memories; only the author edits,
--     deletes or changes the audience. Others never learn a hidden memory exists.
--   - memory_audience: who a 'selected' memory is shared with (trip members only).
--   - memory_photos: photos of a memory, stored at '<trip id>/<memory id>/<uuid>.<ext>' in the
--     PRIVATE bucket 'trip-memories' (10 MB, JPEG/PNG/WebP). Photos follow the memory's
--     audience: the storage read policy checks it through the photo row.
--   - trip_members(trip): the owner and every person the trip is shared with, with their
--     email, for any member of that trip (invitees cannot list trip_shares themselves).
--   - Someone removed from a trip loses access to all its memories at once (every check
--     requires current membership) and their memory_audience rows of that trip are deleted.
--     Memories they authored stay with the trip: the remaining members keep seeing the ones
--     shared with the whole trip; nobody can edit them any more.
-- Every policy applies to signed-in users only (anonymous-auth guests use the authenticated
-- role); nothing is granted to the anon role.

-- 1. Tables ---------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  author_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  note TEXT CHECK (note IS NULL OR char_length(note) <= 4000),
  rating SMALLINT CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  audience TEXT NOT NULL DEFAULT 'trip' CHECK (audience IN ('trip', 'selected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memories_trip_activity ON memories(trip_id, activity_id);

CREATE TABLE IF NOT EXISTS memory_audience (
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_audience_user ON memory_audience(user_id);

CREATE TABLE IF NOT EXISTS memory_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  -- Denormalized for the policies and the trip-wide load; the trigger below pins it to the memory's trip.
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  caption TEXT CHECK (caption IS NULL OR char_length(caption) <= 500),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The object always lives in the folder of its own trip and memory.
  CONSTRAINT memory_photos_path_format CHECK (
    path ~ ('^' || trip_id::text || '/' || memory_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_photos_path ON memory_photos(path);
CREATE INDEX IF NOT EXISTS idx_memory_photos_memory ON memory_photos(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_photos_trip ON memory_photos(trip_id);

-- 2. Integrity triggers ---------------------------------------------------------------------

-- A memory's activity must belong to the memory's trip. SECURITY DEFINER so the check never
-- depends on what the caller may read.
CREATE OR REPLACE FUNCTION memories_check_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM activities WHERE id = NEW.activity_id AND trip_id = NEW.trip_id
  ) THEN
    RAISE EXCEPTION 'memories: the activity does not belong to this trip' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION memories_check_activity() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS memories_check_activity ON memories;
CREATE TRIGGER memories_check_activity BEFORE INSERT OR UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_check_activity();

-- updated_at, and a memory never moves to another trip or changes author. The only exception
-- is transfer_anonymous_data (transfer_anon_data.sql), which moves a guest's memories to the
-- account they sign up with and flags it for its own transaction.
CREATE OR REPLACE FUNCTION memories_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id THEN
    RAISE EXCEPTION 'memories: trip_id cannot change';
  END IF;
  IF NEW.author_id IS DISTINCT FROM OLD.author_id
    AND current_setting('plania.memories_transfer', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'memories: author_id cannot change';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS memories_before_update ON memories;
CREATE TRIGGER memories_before_update BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_before_update();

-- A photo's trip is its memory's trip, and a photo never moves to another memory or object.
CREATE OR REPLACE FUNCTION memory_photos_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.memory_id IS DISTINCT FROM OLD.memory_id
    OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
    OR NEW.path IS DISTINCT FROM OLD.path
  ) THEN
    RAISE EXCEPTION 'memory_photos: memory_id, trip_id and path cannot change';
  END IF;
  -- Only the memory's author may write its photos (row security rejects everyone else). For
  -- anyone else, step aside and let that generic rejection answer, so this trigger's own error
  -- never tells them that a memory hidden from them exists.
  SELECT trip_id INTO v_trip FROM memories WHERE id = NEW.memory_id AND author_id = auth.uid();
  IF v_trip IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.trip_id IS DISTINCT FROM v_trip THEN
    RAISE EXCEPTION 'memory_photos: trip_id must be the trip of the memory' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION memory_photos_before_write() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS memory_photos_before_write ON memory_photos;
CREATE TRIGGER memory_photos_before_write BEFORE INSERT OR UPDATE ON memory_photos
  FOR EACH ROW EXECUTE FUNCTION memory_photos_before_write();

-- 3. Helpers (SECURITY DEFINER: they read across the RLS of these tables without recursion) --

-- May the caller see this memory? Only a current member of its trip, and then only when it is
-- shared with the whole trip, the caller wrote it, or the caller is in its audience.
CREATE OR REPLACE FUNCTION can_see_memory(p_memory_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memories m
    WHERE m.id = p_memory_id
      AND is_trip_member(m.trip_id, auth.uid())
      AND (
        m.author_id = auth.uid()
        OR m.audience = 'trip'
        OR EXISTS (SELECT 1 FROM memory_audience a WHERE a.memory_id = m.id AND a.user_id = auth.uid())
      )
  );
$$;

REVOKE ALL ON FUNCTION can_see_memory(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_see_memory(UUID) TO authenticated;

-- Is the caller the author of this memory and still a member of its trip?
CREATE OR REPLACE FUNCTION is_memory_author(p_memory_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memories m
    WHERE m.id = p_memory_id
      AND m.author_id = auth.uid()
      AND is_trip_member(m.trip_id, auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION is_memory_author(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_memory_author(UUID) TO authenticated;

-- May p_user_id be in the audience of this memory? Only a member of the memory's trip. It only
-- answers the memory's author (the only one who may change its audience), so nobody else can
-- use it to learn that a memory hidden from them exists.
CREATE OR REPLACE FUNCTION memory_audience_member_ok(p_memory_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memories m
    WHERE m.id = p_memory_id
      AND m.author_id = auth.uid()
      AND is_trip_member(m.trip_id, p_user_id)
  );
$$;

REVOKE ALL ON FUNCTION memory_audience_member_ok(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION memory_audience_member_ok(UUID, UUID) TO authenticated;

-- The people of a trip (owner first, then every share) with their email. It only answers a
-- current member of that trip; anyone else gets no rows. Dropped first so this file can run
-- again after activity_participants_migration.sql (which adds columns; re-run that one after).
DROP FUNCTION IF EXISTS trip_members(UUID);
CREATE OR REPLACE FUNCTION trip_members(p_trip_id UUID)
RETURNS TABLE (user_id UUID, email TEXT, is_owner BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.user_id, u.email::text, true
  FROM trips t
  JOIN auth.users u ON u.id = t.user_id
  WHERE t.id = p_trip_id AND is_trip_member(p_trip_id, auth.uid())
  UNION ALL
  SELECT s.shared_with, u.email::text, false
  FROM trip_shares s
  JOIN trips t ON t.id = s.trip_id
  JOIN auth.users u ON u.id = s.shared_with
  WHERE s.trip_id = p_trip_id
    AND s.shared_with IS DISTINCT FROM t.user_id
    AND is_trip_member(p_trip_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION trip_members(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION trip_members(UUID) TO authenticated;

-- 4. Row level security ---------------------------------------------------------------------

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_audience ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_photos ENABLE ROW LEVEL SECURITY;

-- The author's own branch is the same rule as can_see_memory; it is inline so the row an
-- author has just written passes in the same statement (a STABLE helper cannot see it yet).
DROP POLICY IF EXISTS "memories_select" ON memories;
CREATE POLICY "memories_select" ON memories FOR SELECT TO authenticated
  USING (
    (author_id = auth.uid() AND is_trip_member(trip_id, auth.uid()))
    OR can_see_memory(id)
  );

DROP POLICY IF EXISTS "memories_insert" ON memories;
CREATE POLICY "memories_insert" ON memories FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND is_trip_member(trip_id, auth.uid())
  );

DROP POLICY IF EXISTS "memories_update" ON memories;
CREATE POLICY "memories_update" ON memories FOR UPDATE TO authenticated
  USING (
    author_id = auth.uid()
    AND is_trip_member(trip_id, auth.uid())
  )
  WITH CHECK (
    author_id = auth.uid()
    AND is_trip_member(trip_id, auth.uid())
  );

DROP POLICY IF EXISTS "memories_delete" ON memories;
CREATE POLICY "memories_delete" ON memories FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    AND is_trip_member(trip_id, auth.uid())
  );

DROP POLICY IF EXISTS "memory_audience_select" ON memory_audience;
CREATE POLICY "memory_audience_select" ON memory_audience FOR SELECT TO authenticated
  USING (can_see_memory(memory_id));

DROP POLICY IF EXISTS "memory_audience_insert" ON memory_audience;
CREATE POLICY "memory_audience_insert" ON memory_audience FOR INSERT TO authenticated
  WITH CHECK (
    is_memory_author(memory_id)
    AND memory_audience_member_ok(memory_id, user_id)
  );

DROP POLICY IF EXISTS "memory_audience_delete" ON memory_audience;
CREATE POLICY "memory_audience_delete" ON memory_audience FOR DELETE TO authenticated
  USING (is_memory_author(memory_id));

DROP POLICY IF EXISTS "memory_photos_select" ON memory_photos;
CREATE POLICY "memory_photos_select" ON memory_photos FOR SELECT TO authenticated
  USING (can_see_memory(memory_id));

DROP POLICY IF EXISTS "memory_photos_insert" ON memory_photos;
CREATE POLICY "memory_photos_insert" ON memory_photos FOR INSERT TO authenticated
  WITH CHECK (is_memory_author(memory_id));

DROP POLICY IF EXISTS "memory_photos_update" ON memory_photos;
CREATE POLICY "memory_photos_update" ON memory_photos FOR UPDATE TO authenticated
  USING (is_memory_author(memory_id))
  WITH CHECK (is_memory_author(memory_id));

DROP POLICY IF EXISTS "memory_photos_delete" ON memory_photos;
CREATE POLICY "memory_photos_delete" ON memory_photos FOR DELETE TO authenticated
  USING (is_memory_author(memory_id));

-- 5. Removing someone from a trip -----------------------------------------------------------

-- Membership checks already hide everything from them; this also drops them from the
-- audiences of that trip's memories. SECURITY DEFINER: the person removing the share is not
-- the author of those memories.
CREATE OR REPLACE FUNCTION memory_audience_remove_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM memory_audience
  WHERE user_id = OLD.shared_with
    AND memory_id IN (SELECT id FROM memories WHERE trip_id = OLD.trip_id);
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION memory_audience_remove_member() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS memory_audience_remove_member ON trip_shares;
CREATE TRIGGER memory_audience_remove_member AFTER DELETE ON trip_shares
  FOR EACH ROW EXECUTE FUNCTION memory_audience_remove_member();

-- 6. Storage --------------------------------------------------------------------------------

-- Private bucket with size and type limits (re-running keeps it private and limited).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('trip-memories', 'trip-memories', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- May the caller write this object? Only an object named exactly
-- '<trip id>/<memory id>/<uuid>.<jpg|png|webp>' whose memory belongs to that trip and was
-- written by the caller, who is still a member. The name is checked before any cast, so a
-- malformed name can never make a policy throw.
CREATE OR REPLACE FUNCTION can_write_memory_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uuid CONSTANT TEXT := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_folders TEXT[];
BEGIN
  IF p_name IS NULL OR p_name !~ ('^' || v_uuid || '/' || v_uuid || '/' || v_uuid || '\.(jpg|png|webp)$') THEN
    RETURN false;
  END IF;
  v_folders := storage.foldername(p_name);
  RETURN EXISTS (
    SELECT 1 FROM memories m
    WHERE m.id = v_folders[2]::uuid
      AND m.trip_id = v_folders[1]::uuid
      AND m.author_id = auth.uid()
      AND is_trip_member(m.trip_id, auth.uid())
  );
END;
$$;

REVOKE ALL ON FUNCTION can_write_memory_object(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_write_memory_object(TEXT) TO authenticated;

-- May the caller read this object? Only when a photo row points at exactly this name and the
-- caller may see that photo's memory: photos follow the memory's audience.
CREATE OR REPLACE FUNCTION can_read_memory_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memory_photos p
    WHERE p.path = p_name
      AND can_see_memory(p.memory_id)
  );
$$;

REVOKE ALL ON FUNCTION can_read_memory_object(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION can_read_memory_object(TEXT) TO authenticated;

-- The author may also read objects of their own memory before its photo row exists (upload).
DROP POLICY IF EXISTS "trip_memories_select" ON storage.objects;
CREATE POLICY "trip_memories_select" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trip-memories'
    AND (can_read_memory_object(name) OR can_write_memory_object(name))
  );

DROP POLICY IF EXISTS "trip_memories_insert" ON storage.objects;
CREATE POLICY "trip_memories_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'trip-memories'
    AND can_write_memory_object(name)
  );

DROP POLICY IF EXISTS "trip_memories_update" ON storage.objects;
CREATE POLICY "trip_memories_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'trip-memories'
    AND can_write_memory_object(name)
  )
  WITH CHECK (
    bucket_id = 'trip-memories'
    AND can_write_memory_object(name)
  );

DROP POLICY IF EXISTS "trip_memories_delete" ON storage.objects;
CREATE POLICY "trip_memories_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'trip-memories'
    AND can_write_memory_object(name)
  );
