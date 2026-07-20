-- Atomic student-course timetable import: upsert units + enrolment dates/status in one transaction.
-- Same-course updates preserve enrollment_status unless an explicit transition is requested.
-- One-In-Progress and date-overlap checks exclude the enrolment being updated.

CREATE OR REPLACE FUNCTION public.skyline_import_student_course_timetable(
  p_student_id BIGINT,
  p_course_id BIGINT,
  p_units JSONB DEFAULT '[]'::JSONB,
  p_enrollment_status TEXT DEFAULT NULL,
  p_explicit_status BOOLEAN DEFAULT FALSE,
  p_actor_user_id BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.skyline_student_courses%ROWTYPE;
  v_status TEXT;
  v_prev_status TEXT;
  v_is_new BOOLEAN := FALSE;
  v_unit JSONB;
  v_form_id BIGINT;
  v_start DATE;
  v_end DATE;
  v_instance_id BIGINT;
  v_created INT := 0;
  v_updated INT := 0;
  v_unchanged INT := 0;
  v_course_start DATE;
  v_course_end DATE;
  v_other_ip BIGINT;
  v_other_name TEXT;
  v_other_qual TEXT;
  v_course_name TEXT;
  v_course_qual TEXT;
  v_safe_form_ids BIGINT[];
  v_link_count INT;
BEGIN
  IF p_student_id IS NULL OR p_course_id IS NULL OR p_student_id <= 0 OR p_course_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid student or course.');
  END IF;

  PERFORM pg_advisory_xact_lock(872314002, (p_student_id % 2147483647)::INT);

  SELECT * INTO v_existing
  FROM public.skyline_student_courses
  WHERE student_id = p_student_id AND course_id = p_course_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_is_new := TRUE;
    v_prev_status := 'tentative';
  ELSE
    v_prev_status := COALESCE(v_existing.enrollment_status, 'tentative');
  END IF;

  SELECT c.name, c.qualification_code INTO v_course_name, v_course_qual
  FROM public.skyline_courses c
  WHERE c.id = p_course_id;

  IF v_course_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Course not found.');
  END IF;

  -- Resolve status: preserve existing when not explicit; default new enrolments carefully.
  IF NOT p_explicit_status OR NULLIF(TRIM(COALESCE(p_enrollment_status, '')), '') IS NULL THEN
    IF v_is_new THEN
      SELECT sc.course_id INTO v_other_ip
      FROM public.skyline_student_courses sc
      WHERE sc.student_id = p_student_id
        AND sc.status = 'active'
        AND sc.enrollment_status = 'in_progress'
        AND sc.course_id IS DISTINCT FROM p_course_id
      LIMIT 1;
      IF v_other_ip IS NOT NULL THEN
        v_status := 'tentative';
      ELSE
        v_status := 'tentative'; -- dates applied after unit upsert; stay tentative until dates exist unless caller sets IP
      END IF;
    ELSE
      v_status := v_prev_status;
    END IF;
  ELSE
    v_status := LOWER(REPLACE(TRIM(p_enrollment_status), ' ', '_'));
    IF v_status = 'inprogress' THEN v_status := 'in_progress'; END IF;
    IF v_status NOT IN ('tentative', 'in_progress', 'suspended', 'cancelled', 'completed') THEN
      RETURN jsonb_build_object('ok', false, 'error', format('Invalid Course Status "%s".', p_enrollment_status));
    END IF;
    IF NOT v_is_new AND v_status IS DISTINCT FROM v_prev_status THEN
      IF NOT (
        (v_prev_status = 'tentative' AND v_status IN ('in_progress', 'cancelled'))
        OR (v_prev_status = 'in_progress' AND v_status IN ('suspended', 'completed', 'cancelled'))
        OR (v_prev_status = 'suspended' AND v_status IN ('in_progress', 'completed', 'cancelled'))
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', format('Cannot change course status from %s to %s.', v_prev_status, v_status)
        );
      END IF;
    END IF;
  END IF;

  -- One In Progress: exclude THIS course (self).
  IF v_status = 'in_progress' THEN
    SELECT sc.course_id, c.name, c.qualification_code
      INTO v_other_ip, v_other_name, v_other_qual
    FROM public.skyline_student_courses sc
    JOIN public.skyline_courses c ON c.id = sc.course_id
    WHERE sc.student_id = p_student_id
      AND sc.status = 'active'
      AND sc.enrollment_status = 'in_progress'
      AND sc.course_id IS DISTINCT FROM p_course_id
    LIMIT 1;
    IF v_other_ip IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format(
          'Student already has %s In Progress. The imported course (%s) cannot also be In Progress. Import it as Tentative or close/suspend the current course.',
          COALESCE(NULLIF(TRIM(v_other_qual), ''), v_other_name, 'another course'),
          COALESCE(NULLIF(TRIM(v_course_qual), ''), v_course_name)
        ),
        'blocking_course_id', v_other_ip
      );
    END IF;
  END IF;

  -- Ensure enrolment row exists (dates filled after units).
  IF v_is_new THEN
    INSERT INTO public.skyline_student_courses (
      student_id, course_id, status, start_date, end_date, enrollment_status,
      created_by, updated_by, enrollment_status_changed_at, enrollment_status_changed_by
    ) VALUES (
      p_student_id, p_course_id, 'active', NULL, NULL, v_status,
      p_actor_user_id, p_actor_user_id, NOW(), p_actor_user_id
    );
  ELSE
    UPDATE public.skyline_student_courses SET
      status = 'active',
      enrollment_status = v_status,
      updated_by = COALESCE(p_actor_user_id, updated_by),
      enrollment_status_changed_by = CASE
        WHEN v_status IS DISTINCT FROM v_prev_status THEN COALESCE(p_actor_user_id, updated_by)
        ELSE enrollment_status_changed_by
      END,
      updated_at = NOW()
    WHERE student_id = p_student_id AND course_id = p_course_id;
  END IF;

  -- Upsert unit instances (business key: student_id + form_id).
  IF p_units IS NOT NULL AND jsonb_typeof(p_units) = 'array' THEN
    FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units)
    LOOP
      v_form_id := NULLIF((v_unit->>'form_id')::BIGINT, 0);
      IF v_form_id IS NULL OR v_form_id <= 0 THEN
        CONTINUE;
      END IF;

      -- Form must be linked to this course.
      SELECT COUNT(*)::INT INTO v_link_count
      FROM public.skyline_course_forms cf
      WHERE cf.course_id = p_course_id AND cf.form_id = v_form_id;
      IF v_link_count = 0 THEN
        -- Also allow forms whose qualification_code matches the course (legacy mapping).
        IF NOT EXISTS (
          SELECT 1
          FROM public.skyline_forms f
          WHERE f.id = v_form_id
            AND UPPER(TRIM(COALESCE(f.qualification_code, ''))) = UPPER(TRIM(COALESCE(v_course_qual, '')))
            AND NULLIF(TRIM(COALESCE(v_course_qual, '')), '') IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'Unit/form % is not mapped to qualification %.',
            v_form_id, COALESCE(v_course_qual, p_course_id::TEXT);
        END IF;
      END IF;

      BEGIN
        v_start := NULLIF(TRIM(COALESCE(v_unit->>'start_date', '')), '')::DATE;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Invalid Activity Start Date for form %.', v_form_id;
      END;
      BEGIN
        v_end := NULLIF(TRIM(COALESCE(v_unit->>'end_date', '')), '')::DATE;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Invalid Activity End Date for form %.', v_form_id;
      END;
      IF v_start IS NOT NULL AND v_end IS NULL THEN
        RAISE EXCEPTION 'Activity End Date is required when Activity Start Date is provided (form %).', v_form_id;
      END IF;
      IF v_end IS NOT NULL AND v_start IS NULL THEN
        RAISE EXCEPTION 'Activity Start Date is required when Activity End Date is provided (form %).', v_form_id;
      END IF;
      IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN
        RAISE EXCEPTION 'Activity End Date cannot be before Activity Start Date (form %).', v_form_id;
      END IF;

      v_instance_id := NULL;
      SELECT i.id INTO v_instance_id
      FROM public.skyline_form_instances i
      WHERE i.student_id = p_student_id AND i.form_id = v_form_id
      ORDER BY i.id
      LIMIT 1
      FOR UPDATE;

      IF v_instance_id IS NULL THEN
        INSERT INTO public.skyline_form_instances (
          form_id, student_id, role_context, status, start_date, end_date, created_by, updated_by
        ) VALUES (
          v_form_id, p_student_id, 'student', 'draft', v_start, v_end, p_actor_user_id, p_actor_user_id
        )
        RETURNING id INTO v_instance_id;
        v_created := v_created + 1;
      ELSIF v_start IS NOT NULL OR v_end IS NOT NULL THEN
        UPDATE public.skyline_form_instances SET
          start_date = CASE WHEN v_start IS NOT NULL OR v_end IS NOT NULL THEN v_start ELSE start_date END,
          end_date = CASE WHEN v_start IS NOT NULL OR v_end IS NOT NULL THEN v_end ELSE end_date END,
          updated_by = COALESCE(p_actor_user_id, updated_by),
          updated_at = NOW()
        WHERE id = v_instance_id;
        v_updated := v_updated + 1;
      ELSE
        v_unchanged := v_unchanged + 1;
      END IF;
    END LOOP;
  END IF;

  -- Recalculate course dates from ALL mapped instances for this student-course (safe forms only).
  SELECT ARRAY_AGG(DISTINCT cf.form_id) INTO v_safe_form_ids
  FROM public.skyline_course_forms cf
  WHERE cf.course_id = p_course_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.skyline_course_forms cf2
      JOIN public.skyline_student_courses sc2
        ON sc2.course_id = cf2.course_id
       AND sc2.student_id = p_student_id
       AND sc2.status = 'active'
      WHERE cf2.form_id = cf.form_id
        AND cf2.course_id IS DISTINCT FROM p_course_id
    );

  IF v_safe_form_ids IS NOT NULL AND cardinality(v_safe_form_ids) > 0 THEN
    SELECT MIN(i.start_date), MAX(i.end_date)
      INTO v_course_start, v_course_end
    FROM public.skyline_form_instances i
    WHERE i.student_id = p_student_id
      AND i.form_id = ANY (v_safe_form_ids);
  END IF;

  -- Fallback: keep prior dates if recompute empty
  IF v_course_start IS NULL AND NOT v_is_new THEN
    v_course_start := v_existing.start_date;
  END IF;
  IF v_course_end IS NULL AND NOT v_is_new THEN
    v_course_end := v_existing.end_date;
  END IF;

  -- New course with dates and no other IP may become in_progress when caller did not force status
  IF v_is_new AND NOT p_explicit_status AND v_course_start IS NOT NULL AND v_course_end IS NOT NULL THEN
    v_other_ip := NULL;
    SELECT sc.course_id INTO v_other_ip
    FROM public.skyline_student_courses sc
    WHERE sc.student_id = p_student_id
      AND sc.status = 'active'
      AND sc.enrollment_status = 'in_progress'
      AND sc.course_id IS DISTINCT FROM p_course_id
    LIMIT 1;
    IF v_other_ip IS NULL THEN
      v_status := 'in_progress';
    END IF;
  END IF;

  IF v_status = 'in_progress' AND (v_course_start IS NULL OR v_course_end IS NULL) THEN
    RAISE EXCEPTION 'Valid course start and end dates are required before a course can be In Progress.';
  END IF;

  -- Overlap with OTHER enrolments only
  IF v_course_start IS NOT NULL AND v_course_end IS NOT NULL AND v_status <> 'cancelled' THEN
    v_other_ip := NULL;
    v_other_name := NULL;
    v_other_qual := NULL;
    v_start := NULL;
    v_end := NULL;
    SELECT sc.course_id, c.name, c.qualification_code, sc.start_date, sc.end_date
      INTO v_other_ip, v_other_name, v_other_qual, v_start, v_end
    FROM public.skyline_student_courses sc
    JOIN public.skyline_courses c ON c.id = sc.course_id
    WHERE sc.student_id = p_student_id
      AND sc.status = 'active'
      AND sc.enrollment_status IS DISTINCT FROM 'cancelled'
      AND sc.course_id IS DISTINCT FROM p_course_id
      AND sc.start_date IS NOT NULL AND sc.end_date IS NOT NULL
      AND public.skyline_course_ranges_overlap(sc.start_date, sc.end_date, v_course_start, v_course_end)
    LIMIT 1;
    IF v_other_ip IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot update % timetable. The resulting course period %–% overlaps with % %–%.',
        COALESCE(NULLIF(TRIM(v_course_qual), ''), v_course_name),
        v_course_start, v_course_end,
        COALESCE(NULLIF(TRIM(v_other_qual), ''), v_other_name, 'another course'),
        v_start, v_end;
    END IF;
  END IF;

  UPDATE public.skyline_student_courses SET
    start_date = v_course_start,
    end_date = v_course_end,
    enrollment_status = v_status,
    updated_by = COALESCE(p_actor_user_id, updated_by),
    updated_at = NOW()
  WHERE student_id = p_student_id AND course_id = p_course_id;

  RETURN jsonb_build_object(
    'ok', true,
    'student_id', p_student_id,
    'course_id', p_course_id,
    'is_new', v_is_new,
    'enrollment_status', v_status,
    'previous_status', v_prev_status,
    'start_date', v_course_start,
    'end_date', v_course_end,
    'units_created', v_created,
    'units_updated', v_updated,
    'units_unchanged', v_unchanged
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_import_student_course_timetable TO authenticated;
GRANT EXECUTE ON FUNCTION public.skyline_import_student_course_timetable TO service_role;
GRANT EXECUTE ON FUNCTION public.skyline_import_student_course_timetable TO anon;

COMMENT ON FUNCTION public.skyline_import_student_course_timetable IS
  'Atomic timetable import for one student-course: upsert units, preserve/update enrolment, recalc dates, exclude self from In Progress/overlap checks.';
