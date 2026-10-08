-- Trip Context v1. This is additive; existing trip rows remain valid with NULL context.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS travel_context JSONB;
