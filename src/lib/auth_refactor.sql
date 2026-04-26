-- 1. Ensure user_id exists on all tables and link to auth.users
ALTER TABLE trips ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Add user_id to child tables for flat RLS policies
ALTER TABLE trip_days ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE activities ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE critical_reservations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();

-- 2. Backfill user_id from parent trips
UPDATE trip_days td SET user_id = t.user_id FROM trips t WHERE td.trip_id = t.id AND td.user_id IS NULL;
UPDATE activities a SET user_id = t.user_id FROM trips t WHERE a.trip_id = t.id AND a.user_id IS NULL;
UPDATE critical_reservations cr SET user_id = t.user_id FROM trips t WHERE cr.trip_id = t.id AND cr.user_id IS NULL;

-- 3. Enable RLS on all tables
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE critical_reservations ENABLE ROW LEVEL SECURITY;

-- 4. Create Unified RLS Policies (Simplifies logic)

-- TRIPS
DROP POLICY IF EXISTS "Users can delete their own trips" ON trips;
DROP POLICY IF EXISTS "Unified trips policy" ON trips;
CREATE POLICY "Unified trips policy" ON trips
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- TRIP DAYS
DROP POLICY IF EXISTS "Users can delete their own trip days" ON trip_days;
DROP POLICY IF EXISTS "Unified trip_days policy" ON trip_days;
CREATE POLICY "Unified trip_days policy" ON trip_days
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ACTIVITIES
DROP POLICY IF EXISTS "Users can delete their own activities" ON activities;
DROP POLICY IF EXISTS "Unified activities policy" ON activities;
CREATE POLICY "Unified activities policy" ON activities
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- RESERVATIONS
DROP POLICY IF EXISTS "Unified reservations policy" ON critical_reservations;
CREATE POLICY "Unified reservations policy" ON critical_reservations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
