-- Bind batches to courses: one course has many batches.
ALTER TABLE skyline_batches
  ADD COLUMN IF NOT EXISTS course_id BIGINT REFERENCES skyline_courses(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_skyline_batches_course_id ON skyline_batches(course_id);

