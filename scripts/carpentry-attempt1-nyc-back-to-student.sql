-- Carpentry certificate (CPC30220): attempt 1 NYC, trainer returned to student.
-- Returns: assessment_instance_id, student_name, unit_name
--
-- Run this entire script in Supabase SQL editor (one statement only).

WITH carpentry_courses AS (
  SELECT c.id
  FROM public.skyline_courses c
  WHERE c.qualification_code ILIKE 'CPC30220%'
     OR c.name ILIKE '%carpentry%'
),
carpentry_forms AS (
  SELECT DISTINCT f.id AS form_id
  FROM public.skyline_forms f
  LEFT JOIN public.skyline_course_forms cf ON cf.form_id = f.id
  LEFT JOIN carpentry_courses cc ON cc.id = cf.course_id
  WHERE f.qualification_code ILIKE 'CPC30220%'
     OR cc.id IS NOT NULL
)
SELECT
  i.id AS assessment_instance_id,
  s.name AS student_name,
  COALESCE(
    NULLIF(TRIM(f.unit_name), ''),
    NULLIF(TRIM(f.name), ''),
    NULLIF(TRIM(f.unit_code), ''),
    '—'
  ) AS unit_name
FROM public.skyline_form_instances i
INNER JOIN carpentry_forms cf ON cf.form_id = i.form_id
INNER JOIN public.skyline_form_assessment_summary_data a ON a.instance_id = i.id
INNER JOIN public.skyline_forms f ON f.id = i.form_id
INNER JOIN public.skyline_students s ON s.id = i.student_id
WHERE a.final_attempt_1_result = 'not_yet_competent'
  AND COALESCE(i.submission_count, 0) = 1
  AND COALESCE(i.role_context, '') = 'student'
  AND COALESCE(i.status, '') = 'draft'
  AND i.submitted_at IS NOT NULL
  AND COALESCE(i.did_not_attempt, false) = false
  AND (s.status IS NULL OR s.status = 'active')
  AND (a.final_attempt_2_result IS NULL OR TRIM(a.final_attempt_2_result) = '')
ORDER BY s.name, unit_name, i.id;
