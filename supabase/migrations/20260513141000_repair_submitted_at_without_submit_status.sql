-- Repair inconsistent rows: submitted_at / submission_count indicate a student hand-in, but status/role
-- never transitioned (split updates or failed second request). Exclude NYC→resubmit windows where
-- summary shows attempt 1 not_yet_competent and submission_count is still 1.

UPDATE public.skyline_form_instances i
SET
  status = 'submitted',
  role_context = 'trainer',
  updated_at = now()
WHERE i.submitted_at IS NOT NULL
  AND COALESCE(i.status, '') = 'draft'
  AND COALESCE(i.role_context, '') = 'student'
  AND COALESCE(i.submission_count, 0) >= 1
  AND EXISTS (
    SELECT 1
    FROM public.skyline_students s
    INNER JOIN public.skyline_batches b ON b.id = s.batch_id AND b.trainer_id IS NOT NULL
    WHERE s.id = i.student_id
  )
  AND NOT (
    COALESCE(i.submission_count, 0) = 1
    AND EXISTS (
      SELECT 1
      FROM public.skyline_form_assessment_summary_data a
      WHERE a.instance_id = i.id
        AND a.final_attempt_1_result = 'not_yet_competent'
    )
  );
