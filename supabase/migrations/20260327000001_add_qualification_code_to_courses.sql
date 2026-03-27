-- Qualification code per course (distinct from display name).
ALTER TABLE skyline_courses
  ADD COLUMN IF NOT EXISTS qualification_code TEXT;

CREATE INDEX IF NOT EXISTS idx_skyline_courses_qualification_code ON skyline_courses(qualification_code);
