-- Admin delete student: block only when at least one form instance has been submitted.
-- Allocated-but-unsubmitted instances are deleted with the student.

CREATE OR REPLACE FUNCTION public.skyline_admin_delete_student_if_no_assessments(
  p_student_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_student_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing student id.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.skyline_form_instances i
    WHERE i.student_id = p_student_id
      AND (
        i.submitted_at IS NOT NULL
        OR COALESCE(i.submission_count, 0) > 0
      )
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cannot delete. This student has submitted assessments.');
  END IF;

  DELETE FROM public.skyline_form_instances WHERE student_id = p_student_id;

  DELETE FROM public.skyline_student_courses WHERE student_id = p_student_id;
  DELETE FROM public.skyline_induction_submissions WHERE student_id = p_student_id;
  DELETE FROM public.skyline_induction_sessions WHERE student_id = p_student_id;

  DELETE FROM public.skyline_students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Student not found.');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not delete student.');
END;
$$;

COMMENT ON FUNCTION public.skyline_admin_delete_student_if_no_assessments(bigint) IS 'Staff: delete student if no submitted assessments; removes allocated-unsubmitted instances.';
