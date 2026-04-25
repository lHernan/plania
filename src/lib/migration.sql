-- Add user_id column to trips table
ALTER TABLE trips ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Optional: Index for performance
CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);

-- Enable RLS (Row Level Security) if not already enabled
-- Note: You might need to adjust your RLS policies to allow guest access (user_id IS NULL)
-- or keep it disabled for now as per current project state.
