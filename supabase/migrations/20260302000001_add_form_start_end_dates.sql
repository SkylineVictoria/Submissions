-- Add start_date and end_date to forms (YYYY-MM-DD)
-- Link access expires at end_date; admin can revoke or re-enable
ALTER TABLE skyline_forms
  ADD COLUMN IF NOT EXISTS start_date TEXT,
  ADD COLUMN IF NOT EXISTS end_date TEXT;
