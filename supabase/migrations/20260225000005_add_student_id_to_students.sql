-- Add custom student ID field for admin/student management UI.
ALTER TABLE skyline_students
  ADD COLUMN IF NOT EXISTS student_id TEXT;

CREATE INDEX IF NOT EXISTS idx_skyline_students_student_id
  ON skyline_students(student_id);
