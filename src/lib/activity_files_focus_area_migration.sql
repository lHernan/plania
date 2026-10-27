-- Adds the focus area of an attachment: the box around its QR code or barcode that the
-- traveler marked by hand, normalized to the page (x, y, width, height from 0 to 1, plus an
-- optional page index). The app already reads and writes it (setFileFocusArea).
-- Run once in the Supabase SQL editor; safe to run again.

ALTER TABLE activity_files ADD COLUMN IF NOT EXISTS focus_area JSONB;
