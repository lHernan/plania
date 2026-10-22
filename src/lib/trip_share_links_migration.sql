-- ============================================================
-- Migration: Trip Share Links (public / email-targeted invites)
-- ============================================================
-- Run this in the Supabase SQL Editor.
-- Supports read-only public links and email-targeted invitations
-- that can be accepted by any (possibly new) user.

CREATE TABLE IF NOT EXISTS trip_share_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),
  email        TEXT,
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  accepted_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE trip_share_links ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_trip_share_links_trip_id ON trip_share_links(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_share_links_token ON trip_share_links(token);
CREATE INDEX IF NOT EXISTS idx_trip_share_links_email ON trip_share_links(email);

-- Owner can manage their links
DROP POLICY IF EXISTS "trip_share_links_owner_all" ON trip_share_links;
CREATE POLICY "trip_share_links_owner_all" ON trip_share_links FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Anyone (including anon) can SELECT a link by token to validate it
DROP POLICY IF EXISTS "trip_share_links_select_by_token" ON trip_share_links;
CREATE POLICY "trip_share_links_select_by_token" ON trip_share_links FOR SELECT
  USING (true);

-- Acceptance happens via service role in the API route.
filePath">
D:\Dev\repos\plania\src\lib\trip_share_links_migration.sql