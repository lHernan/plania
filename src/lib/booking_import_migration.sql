-- Booking import: distinguish confirmed bookings and accepted AI suggestions from
-- manually added activities, and keep the structured booking data extracted from PDFs.
-- Additive only: existing rows become origin = 'manual' and booking = NULL.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual'
    CHECK (origin IN ('manual', 'booking', 'suggested'));

-- Structured booking details (type, provider, reference, local start/end with time zone,
-- from/to, pickup/dropoff, source file fingerprint, per-field extraction status).
-- Shape is versioned in the app (BookingDetails.version) and validated before saving.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS booking jsonb;

-- Duplicate detection looks bookings up by reference and by source file fingerprint.
CREATE INDEX IF NOT EXISTS activities_booking_reference_idx
  ON activities ((booking ->> 'reference'))
  WHERE booking IS NOT NULL;

CREATE INDEX IF NOT EXISTS activities_booking_source_sha_idx
  ON activities ((booking -> 'source' ->> 'sha256'))
  WHERE booking IS NOT NULL;
