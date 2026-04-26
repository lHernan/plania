-- ============================================================
-- Migration: Activity Files and Storage
-- ============================================================

-- 1. Create activity_files table
CREATE TABLE IF NOT EXISTS activity_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID REFERENCES activities(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE, -- Useful for global user queries
  user_id UUID NOT NULL REFERENCES auth.users(id),
  file_url TEXT NOT NULL,
  file_path TEXT NOT NULL, -- The path in storage: {user_id}/{activity_id}/{file_name}
  file_type TEXT, -- pdf | image
  file_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE activity_files ENABLE ROW LEVEL SECURITY;

-- 3. Unified RLS policy for activity_files
DROP POLICY IF EXISTS "Unified activity_files policy" ON activity_files;
CREATE POLICY "Unified activity_files policy" ON activity_files
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. Set up Supabase Storage for activity-files bucket
-- Note: Buckets must be created via the dashboard or via the storage.buckets table.
-- Here we provide the SQL to ensure it's configured if created.

INSERT INTO storage.buckets (id, name, public)
VALUES ('activity-files', 'activity-files', false)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage RLS Policies
-- Users can only upload/view/delete their own files in their folder ({user_id}/...)

DROP POLICY IF EXISTS "Users can upload their own activity files" ON storage.objects;
CREATE POLICY "Users can upload their own activity files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'activity-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can view their own activity files" ON storage.objects;
CREATE POLICY "Users can view their own activity files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'activity-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete their own activity files" ON storage.objects;
CREATE POLICY "Users can delete their own activity files" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'activity-files' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
