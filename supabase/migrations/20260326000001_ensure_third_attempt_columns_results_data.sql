-- Ensure third attempt columns exist (idempotent; fixes DBs that skipped 20260310000001)
ALTER TABLE skyline_form_results_data
  ADD COLUMN IF NOT EXISTS third_attempt_satisfactory TEXT CHECK (third_attempt_satisfactory IN ('s', 'ns')),
  ADD COLUMN IF NOT EXISTS third_attempt_date TEXT,
  ADD COLUMN IF NOT EXISTS third_attempt_feedback TEXT;
