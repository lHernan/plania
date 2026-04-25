-- 1. Update trips table with new metadata fields
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Add trip_id to activities for flatter access
ALTER TABLE activities ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES trips(id) ON DELETE CASCADE;

-- 3. DATA MIGRATION: Ensure all existing data is linked correctly
DO $$ 
BEGIN
    -- Create a default trip if none exists (Safety fallback)
    IF NOT EXISTS (SELECT 1 FROM trips) THEN
        INSERT INTO trips (name) VALUES ('My First Trip');
    END IF;

    -- Link activities to trips via their parent day
    UPDATE activities a
    SET trip_id = td.trip_id
    FROM trip_days td
    WHERE a.day_id = td.id
    AND a.trip_id IS NULL;

    -- Handle any orphaned activities (shouldn't happen with FKs but for safety)
    UPDATE activities
    SET trip_id = (SELECT id FROM trips ORDER BY created_at ASC LIMIT 1)
    WHERE trip_id IS NULL;
END $$;

-- 4. Set trip_id to NOT NULL after migration
ALTER TABLE activities ALTER COLUMN trip_id SET NOT NULL;

-- 5. Optional: Indexes for faster multi-trip querying
CREATE INDEX IF NOT EXISTS idx_activities_trip_id ON activities(trip_id);
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON trips(created_at);


-- Allow users to delete their own trips
CREATE POLICY "Users can delete their own trips" 
ON trips FOR DELETE 
USING (auth.uid() = user_id);

-- Also ensure you can delete related records
CREATE POLICY "Users can delete their own trip days" 
ON trip_days FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM trips 
    WHERE trips.id = trip_days.trip_id 
    AND trips.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete their own activities" 
ON activities FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM trips 
    WHERE trips.id = activities.trip_id 
    AND trips.user_id = auth.uid()
  )
);
