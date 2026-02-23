-- Add Student Name and Student Signature to results data (Student Declaration in task results)
ALTER TABLE skyline_form_results_data
  ADD COLUMN IF NOT EXISTS student_name TEXT,
  ADD COLUMN IF NOT EXISTS student_signature TEXT;
