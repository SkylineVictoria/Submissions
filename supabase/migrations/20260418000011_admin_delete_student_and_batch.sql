-- Admin deletes with safety checks:
-- - delete student only when they have NO assessment/form instance records
-- - delete batch only when ALL students in it are inactive (no active students)

CREATE OR REPLACE FUNCTION skyline_admin_delete_student_if_no_assessments(
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
    SELECT 1 FROM skyline_form_instances i
    WHERE i.student_id = p_student_id
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cannot delete. This student has activity.');
  END IF;

  -- Remove lightweight dependent rows to avoid FK blocks.
  DELETE FROM skyline_student_courses WHERE student_id = p_student_id;
  DELETE FROM skyline_induction_submissions WHERE student_id = p_student_id;
  DELETE FROM skyline_induction_sessions WHERE student_id = p_student_id;

  DELETE FROM skyline_students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Student not found.');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not delete student.');
END;
$$;

CREATE OR REPLACE FUNCTION skyline_admin_delete_batch_if_all_students_inactive(
  p_batch_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_batch_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing batch id.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM skyline_students s
    WHERE s.batch_id = p_batch_id
      AND (s.status IS NULL OR s.status = 'active')
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Cannot delete. This batch has active students.');
  END IF;

  UPDATE skyline_students
  SET batch_id = null
  WHERE batch_id = p_batch_id;

  DELETE FROM skyline_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Batch not found.');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not delete batch.');
END;
$$;

GRANT EXECUTE ON FUNCTION skyline_admin_delete_student_if_no_assessments(bigint) TO anon;
GRANT EXECUTE ON FUNCTION skyline_admin_delete_student_if_no_assessments(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION skyline_admin_delete_batch_if_all_students_inactive(bigint) TO anon;
GRANT EXECUTE ON FUNCTION skyline_admin_delete_batch_if_all_students_inactive(bigint) TO authenticated;

COMMENT ON FUNCTION skyline_admin_delete_student_if_no_assessments(bigint) IS 'Staff: delete student only if they have no form instances.';
COMMENT ON FUNCTION skyline_admin_delete_batch_if_all_students_inactive(bigint) IS 'Staff: delete batch only if it has no active students.';

