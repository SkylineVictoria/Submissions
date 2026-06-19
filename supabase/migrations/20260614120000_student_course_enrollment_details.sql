-- Per-student course enrollment details (many courses per student, each with its own dates/status).

ALTER TABLE public.skyline_student_courses
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS enrollment_status TEXT NOT NULL DEFAULT 'in_progress',
  ADD COLUMN IF NOT EXISTS completed_at DATE,
  ADD COLUMN IF NOT EXISTS intake_label TEXT;

ALTER TABLE public.skyline_student_courses
  DROP CONSTRAINT IF EXISTS skyline_student_courses_enrollment_status_check;

ALTER TABLE public.skyline_student_courses
  ADD CONSTRAINT skyline_student_courses_enrollment_status_check
  CHECK (enrollment_status IN ('in_progress', 'completed', 'suspended'));

UPDATE public.skyline_student_courses
SET enrollment_status = 'in_progress'
WHERE enrollment_status IS NULL OR enrollment_status NOT IN ('in_progress', 'completed', 'suspended');
