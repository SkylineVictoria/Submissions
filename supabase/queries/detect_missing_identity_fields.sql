-- Detect submitted/attempted instances with missing first-page identity fields.
-- Run in Supabase SQL editor (may need batching on large datasets).

WITH identity_questions AS (
  SELECT q.id AS question_id, st.form_id, q.code
  FROM skyline_form_questions q
  JOIN skyline_form_sections sec ON sec.id = q.section_id
  JOIN skyline_form_steps st ON st.id = sec.step_id
  WHERE q.code IN ('student.fullName', 'student.id', 'student.email', 'trainer.fullName')
),
attempted AS (
  SELECT
    i.id AS instance_id,
    i.form_id,
    i.student_id,
    i.submission_count,
    i.submitted_at,
    i.status,
    i.role_context,
    s.name AS profile_name,
    s.email AS profile_email,
    s.student_id AS profile_student_code
  FROM skyline_form_instances i
  LEFT JOIN skyline_students s ON s.id = i.student_id
  WHERE i.student_id IS NOT NULL
    AND (
      COALESCE(i.submission_count, 0) > 0
      OR i.submitted_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM skyline_form_results_data rd
        WHERE rd.instance_id = i.id AND COALESCE(rd.student_signature, '') <> ''
      )
      OR EXISTS (
        SELECT 1 FROM skyline_form_answers a
        WHERE a.instance_id = i.id
          AND (COALESCE(a.value_text, '') <> '' OR a.value_json IS NOT NULL)
      )
    )
),
identity_answers AS (
  SELECT a.instance_id, iq.code, NULLIF(TRIM(COALESCE(a.value_text, '')), '') AS value
  FROM skyline_form_answers a
  JOIN attempted att ON att.instance_id = a.instance_id
  JOIN identity_questions iq ON iq.question_id = a.question_id AND iq.form_id = att.form_id
  WHERE a.row_id IS NULL
),
pivoted AS (
  SELECT
    instance_id,
    MAX(value) FILTER (WHERE code = 'student.fullName') AS student_full_name,
    MAX(value) FILTER (WHERE code = 'student.id') AS student_id_val,
    MAX(value) FILTER (WHERE code = 'student.email') AS student_email,
    MAX(value) FILTER (WHERE code = 'trainer.fullName') AS trainer_full_name
  FROM identity_answers
  GROUP BY instance_id
)
SELECT
  a.instance_id,
  a.student_id,
  a.profile_name,
  a.profile_email,
  a.profile_student_code,
  a.submission_count,
  a.submitted_at,
  a.status,
  a.role_context,
  EXISTS (
    SELECT 1 FROM skyline_form_results_data rd
    WHERE rd.instance_id = a.instance_id AND COALESCE(rd.student_signature, '') <> ''
  ) AS has_student_signature,
  EXISTS (
    SELECT 1 FROM skyline_form_answers ans
    WHERE ans.instance_id = a.instance_id
      AND ans.question_id NOT IN (
        SELECT question_id FROM identity_questions iq WHERE iq.form_id = a.form_id
      )
      AND (COALESCE(ans.value_text, '') <> '' OR ans.value_json IS NOT NULL)
  ) AS has_other_answers,
  p.student_full_name,
  p.student_id_val,
  p.student_email,
  p.trainer_full_name,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.student_full_name IS NULL THEN 'student.fullName' END,
    CASE WHEN p.student_id_val IS NULL THEN 'student.id' END,
    CASE WHEN p.student_email IS NULL THEN 'student.email' END,
    CASE WHEN p.trainer_full_name IS NULL THEN 'trainer.fullName' END
  ], NULL) AS missing_fields
FROM attempted a
LEFT JOIN pivoted p ON p.instance_id = a.instance_id
WHERE
  p.student_full_name IS NULL
  OR p.student_id_val IS NULL
  OR p.student_email IS NULL
  OR p.trainer_full_name IS NULL
ORDER BY a.instance_id DESC;
