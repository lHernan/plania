-- Shopping list per trip, shared with the people the trip is shared with.
-- Run once in the Supabase SQL editor, after trip_shares_migration.sql and
-- trip_shares_role_migration.sql (it uses is_trip_owner and is_trip_editor).
--
-- Access follows the trip, not the row author:
--   - read: the trip owner and anyone the trip is shared with (viewer or editor)
--   - write: the trip owner and shared editors
-- user_id only records who added the item; it never grants access, so an anonymous
-- guest's rows keep working after transfer_anon_data moves the trip to the new account.

CREATE TABLE IF NOT EXISTS shopping_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('souvenir', 'fashion', 'beauty', 'food', 'home', 'electronics', 'other')),
  notes TEXT,
  preferred_cities TEXT[],
  preferred_country TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'purchased', 'hidden')),
  shop_categories TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopping_items_trip_id ON shopping_items(trip_id);

ALTER TABLE shopping_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shopping_items_select" ON shopping_items;
CREATE POLICY "shopping_items_select" ON shopping_items FOR SELECT
  USING (
    is_trip_owner(trip_id)
    OR EXISTS (
      SELECT 1 FROM trip_shares
      WHERE trip_shares.trip_id = shopping_items.trip_id
        AND trip_shares.shared_with = auth.uid()
    )
  );

DROP POLICY IF EXISTS "shopping_items_insert" ON shopping_items;
CREATE POLICY "shopping_items_insert" ON shopping_items FOR INSERT
  WITH CHECK (is_trip_owner(trip_id) OR is_trip_editor(trip_id));

DROP POLICY IF EXISTS "shopping_items_update" ON shopping_items;
CREATE POLICY "shopping_items_update" ON shopping_items FOR UPDATE
  USING (is_trip_owner(trip_id) OR is_trip_editor(trip_id))
  WITH CHECK (is_trip_owner(trip_id) OR is_trip_editor(trip_id));

DROP POLICY IF EXISTS "shopping_items_delete" ON shopping_items;
CREATE POLICY "shopping_items_delete" ON shopping_items FOR DELETE
  USING (is_trip_owner(trip_id) OR is_trip_editor(trip_id));

CREATE OR REPLACE FUNCTION set_shopping_items_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shopping_items_updated_at ON shopping_items;
CREATE TRIGGER shopping_items_updated_at
  BEFORE UPDATE ON shopping_items
  FOR EACH ROW EXECUTE FUNCTION set_shopping_items_updated_at();
