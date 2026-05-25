-- ============================================================
-- Migration: Add Time Inference & Confidence Columns to Activities
-- ============================================================

-- Add time_confidence column (NUMERIC, holds value between 0.0 and 1.0, defaults to 1.0)
ALTER TABLE activities ADD COLUMN IF NOT EXISTS time_confidence NUMERIC DEFAULT 1.0;

-- Add time_inferred column (BOOLEAN, indicates if the time was suggested by AI, defaults to FALSE)
ALTER TABLE activities ADD COLUMN IF NOT EXISTS time_inferred BOOLEAN DEFAULT FALSE;
