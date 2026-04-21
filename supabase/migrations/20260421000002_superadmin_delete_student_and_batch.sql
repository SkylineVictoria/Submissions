-- Superadmin: delete any student (including with assessments) and delete batches with optional per-student full delete.

CREATE OR REPLACE FUNCTION public.skyline_superadmin_delete_student(p_student_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_student_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing student id.');
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

CREATE OR REPLACE FUNCTION public.skyline_superadmin_delete_batch(
  p_batch_id bigint,
  p_student_ids_full_delete bigint[] DEFAULT '{}'::bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid bigint;
  v_res jsonb;
BEGIN
  IF p_batch_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing batch id.');
  END IF;

  IF p_student_ids_full_delete IS NOT NULL AND array_length(p_student_ids_full_delete, 1) IS NOT NULL THEN
    FOREACH v_sid IN ARRAY p_student_ids_full_delete
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.skyline_students s
        WHERE s.id = v_sid AND s.batch_id = p_batch_id
      ) THEN
        v_res := public.skyline_superadmin_delete_student(v_sid);
        IF coalesce((v_res->>'ok')::boolean, false) = false THEN
          RETURN jsonb_build_object('ok', false, 'error', coalesce(v_res->>'error', 'Failed to delete student.'));
        END IF;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.skyline_students
  SET batch_id = null
  WHERE batch_id = p_batch_id;

  DELETE FROM public.skyline_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Batch not found.');
  END IF;

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not delete batch.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_superadmin_delete_student(bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.skyline_superadmin_delete_student(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skyline_superadmin_delete_batch(bigint, bigint[]) TO anon;
GRANT EXECUTE ON FUNCTION public.skyline_superadmin_delete_batch(bigint, bigint[]) TO authenticated;

COMMENT ON FUNCTION public.skyline_superadmin_delete_student(bigint) IS 'Superadmin: delete student and all assessments.';
COMMENT ON FUNCTION public.skyline_superadmin_delete_batch(bigint, bigint[]) IS 'Superadmin: optionally fully delete some students in batch, detach others, then delete batch.';
