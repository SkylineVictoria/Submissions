-- Read-only preflight / audit report for course lifecycle backfill.
-- Run after migration 20260713140000_course_lifecycle_scheduling.sql.
-- Does not modify any rows.

SELECT
  external_student_id,
  internal_student_id,
  student_name,
  enrolment_course_id AS enrolment_id,
  course_id,
  qualification_code,
  course_name,
  existing_enrolment_status,
  existing_course_status,
  existing_course_start_date,
  existing_course_end_date,
  earliest_instance_start,
  earliest_instance_end,
  latest_instance_end,
  instance_count,
  calculated_course_rank,
  proposed_course_status,
  proposed_course_start_date,
  proposed_course_end_date,
  selection_reason,
  overlap_warning,
  date_discrepancy_warning,
  manual_review_warning
FROM public.skyline_course_lifecycle_preflight
ORDER BY student_name, calculated_course_rank, qualification_code;

-- Integrity checks
SELECT 'active_without_lifecycle' AS check_name, COUNT(*) AS cnt
FROM public.skyline_student_courses
WHERE status = 'active'
  AND (enrollment_status IS NULL OR enrollment_status = '');

SELECT 'students_with_multiple_in_progress' AS check_name, COUNT(*) AS cnt
FROM (
  SELECT student_id
  FROM public.skyline_student_courses
  WHERE status = 'active' AND enrollment_status = 'in_progress'
  GROUP BY student_id
  HAVING COUNT(*) > 1
) t;

SELECT 'overlap_pairs_non_cancelled' AS check_name, COUNT(*) AS cnt
FROM public.skyline_student_courses a
JOIN public.skyline_student_courses b
  ON a.student_id = b.student_id
 AND a.course_id < b.course_id
 AND a.status = 'active' AND b.status = 'active'
 AND a.enrollment_status IS DISTINCT FROM 'cancelled'
 AND b.enrollment_status IS DISTINCT FROM 'cancelled'
 AND a.start_date IS NOT NULL AND a.end_date IS NOT NULL
 AND b.start_date IS NOT NULL AND b.end_date IS NOT NULL
 AND public.skyline_course_ranges_overlap(a.start_date, a.end_date, b.start_date, b.end_date);
