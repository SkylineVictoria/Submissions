-- Ensure Trainer Name and Trainer Signature exist in results data
ALTER TABLE skyline_form_results_data
  ADD COLUMN IF NOT EXISTS trainer_name TEXT,
  ADD COLUMN IF NOT EXISTS trainer_signature TEXT,
  ADD COLUMN IF NOT EXISTS trainer_date TEXT;
