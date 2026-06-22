-- Unique Student ID (Contact ID) and validated batch-student assignments.

-- Normalize duplicate student_id values before unique index (keep lowest id).
WITH ranked AS (
  SELECT
    id,
    lower(trim(student_id)) AS norm_id,
    ROW_NUMBER() OVER (PARTITION BY lower(trim(student_id)) ORDER BY id ASC) AS rn
  FROM public.skyline_students
  WHERE student_id IS NOT NULL AND trim(student_id) <> ''
)
UPDATE public.skyline_students s
SET student_id = NULL
FROM ranked r
WHERE s.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_skyline_students_student_id_unique
  ON public.skyline_students (lower(trim(student_id)))
  WHERE student_id IS NOT NULL AND trim(student_id) <> '';

-- Clear invalid batch assignments: student must be actively enrolled in the batch course.
UPDATE public.skyline_students s
SET batch_id = NULL,
    updated_at = now()
WHERE s.batch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.skyline_batches b
    JOIN public.skyline_student_courses sc
      ON sc.student_id = s.id
     AND sc.course_id = b.course_id
     AND sc.status = 'active'
    WHERE b.id = s.batch_id
      AND b.course_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.skyline_update_batch_student_assignments(
  p_batch_id bigint,
  p_student_ids bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_course_id bigint;
  v_sid bigint;
  v_bad bigint[];
BEGIN
  IF p_batch_id IS NULL OR p_batch_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid batch id');
  END IF;

  SELECT course_id INTO v_batch_course_id
  FROM public.skyline_batches
  WHERE id = p_batch_id;

  IF v_batch_course_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Batch has no course assigned');
  END IF;

  SELECT array_agg(DISTINCT sid) INTO v_bad
  FROM unnest(COALESCE(p_student_ids, ARRAY[]::bigint[])) AS sid
  WHERE sid IS NOT NULL AND sid > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.skyline_student_courses sc
      WHERE sc.student_id = sid
        AND sc.course_id = v_batch_course_id
        AND sc.status = 'active'
    );

  IF v_bad IS NOT NULL AND array_length(v_bad, 1) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Student cannot be added to this batch because the student is not enrolled in the batch course.',
      'invalid_student_ids', v_bad
    );
  END IF;

  UPDATE public.skyline_students
  SET batch_id = NULL,
      updated_at = now()
  WHERE batch_id = p_batch_id;

  IF COALESCE(array_length(p_student_ids, 1), 0) > 0 THEN
    UPDATE public.skyline_students
    SET batch_id = p_batch_id,
        updated_at = now()
    WHERE id = ANY(p_student_ids);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_update_batch_student_assignments(bigint, bigint[]) TO authenticated;
