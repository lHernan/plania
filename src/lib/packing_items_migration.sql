-- ============================================================
-- Migration: Packing lists per trip (personal and shared)
-- ============================================================
-- Run once in the Supabase SQL Editor, after trip_shares_migration.sql and
-- trip_shares_role_migration.sql (it uses is_trip_owner and is_trip_editor).
-- Then re-run transfer_anon_data.sql so a guest's packing rows move to the new account.
-- Additive and idempotent: it creates one table, one helper and the table's own policies.
--
-- Each trip has two kinds of lists:
--   - personal ("Mi maleta"): one per person, owner_id = that person. Only that person reads
--     or writes it, and only while they are still on the trip (owner or any share).
--   - shared ("Compartida"): one per trip, owner_id NULL. Every trip member reads it; the trip
--     owner and shared editors write it. assigned_to ("who brings it") must be a trip member.
-- The weather strip and the generation date stay on the device that generated the list.

CREATE TABLE IF NOT EXISTS packing_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('personal', 'shared')),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '' CHECK (char_length(category) <= 100),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 999),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'packed')),
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A personal row always has its owner; a shared row never has one.
  CONSTRAINT packing_items_scope_owner CHECK ((scope = 'personal') = (owner_id IS NOT NULL)),
  -- Only shared items say who brings them.
  CONSTRAINT packing_items_assigned_shared CHECK (assigned_to IS NULL OR scope = 'shared')
);

CREATE INDEX IF NOT EXISTS idx_packing_items_trip_scope ON packing_items(trip_id, scope);

-- Is p_user_id the owner of the trip or someone it is shared with (any role)?
-- It only answers for trips the caller belongs to, so it cannot be used to probe other trips.
CREATE OR REPLACE FUNCTION is_trip_member(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      EXISTS (SELECT 1 FROM trips WHERE id = p_trip_id AND user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM trip_shares WHERE trip_id = p_trip_id AND shared_with = auth.uid())
    )
    AND (
      EXISTS (SELECT 1 FROM trips WHERE id = p_trip_id AND user_id = p_user_id)
      OR EXISTS (SELECT 1 FROM trip_shares WHERE trip_id = p_trip_id AND shared_with = p_user_id)
    );
$$;

REVOKE ALL ON FUNCTION is_trip_member(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_trip_member(UUID, UUID) TO authenticated;

ALTER TABLE packing_items ENABLE ROW LEVEL SECURITY;

-- Policies apply to signed-in users only (anonymous-auth guests use the authenticated role).
DROP POLICY IF EXISTS "packing_items_select" ON packing_items;
CREATE POLICY "packing_items_select" ON packing_items FOR SELECT TO authenticated
  USING (
    (scope = 'personal' AND owner_id = auth.uid() AND is_trip_member(trip_id, auth.uid()))
    OR (scope = 'shared' AND is_trip_member(trip_id, auth.uid()))
  );

DROP POLICY IF EXISTS "packing_items_insert" ON packing_items;
CREATE POLICY "packing_items_insert" ON packing_items FOR INSERT TO authenticated
  WITH CHECK (
    created_by IS NOT DISTINCT FROM auth.uid()
    AND (
      (scope = 'personal' AND owner_id = auth.uid() AND is_trip_member(trip_id, auth.uid()))
      OR (scope = 'shared' AND owner_id IS NULL AND (is_trip_owner(trip_id) OR is_trip_editor(trip_id)) AND (assigned_to IS NULL OR is_trip_member(trip_id, assigned_to)))
    )
  );

DROP POLICY IF EXISTS "packing_items_update" ON packing_items;
CREATE POLICY "packing_items_update" ON packing_items FOR UPDATE TO authenticated
  USING (
    (scope = 'personal' AND owner_id = auth.uid() AND is_trip_member(trip_id, auth.uid()))
    OR (scope = 'shared' AND (is_trip_owner(trip_id) OR is_trip_editor(trip_id)))
  )
  WITH CHECK (
    (scope = 'personal' AND owner_id = auth.uid() AND is_trip_member(trip_id, auth.uid()))
    OR (scope = 'shared' AND owner_id IS NULL AND (is_trip_owner(trip_id) OR is_trip_editor(trip_id)) AND (assigned_to IS NULL OR is_trip_member(trip_id, assigned_to)))
  );

DROP POLICY IF EXISTS "packing_items_delete" ON packing_items;
CREATE POLICY "packing_items_delete" ON packing_items FOR DELETE TO authenticated
  USING (
    (scope = 'personal' AND owner_id = auth.uid() AND is_trip_member(trip_id, auth.uid()))
    OR (scope = 'shared' AND (is_trip_owner(trip_id) OR is_trip_editor(trip_id)))
  );

-- updated_at, and a row never moves to another trip or switches between personal and shared
-- (an upsert of an existing id cannot do it either: it runs as this UPDATE).
CREATE OR REPLACE FUNCTION packing_items_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION 'packing_items: trip_id and scope cannot change';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS packing_items_before_update ON packing_items;
CREATE TRIGGER packing_items_before_update BEFORE UPDATE ON packing_items
  FOR EACH ROW EXECUTE FUNCTION packing_items_before_update();
