-- Course lifecycle + scheduling for skyline_student_courses.
-- Extends existing enrollment_status (keeps link status `status` = active|inactive separate).
-- Adds: tentative, cancelled; audit columns; one in_progress per student; non-overlap for non-cancelled.
-- Does NOT modify assessment instances, answers, or recreate enrolments.
--
-- Order matters: backfill first, then constraints/triggers, so historical overlaps do not fail migration.

-- ---------------------------------------------------------------------------
-- 1. Schema: extend lifecycle values + audit columns (no unique/trigger yet)
-- ---------------------------------------------------------------------------
ALTER TABLE public.skyline_student_courses
  ADD COLUMN IF NOT EXISTS enrollment_status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrollment_status_changed_by BIGINT REFERENCES public.skyline_users(id);

ALTER TABLE public.skyline_student_courses
  DROP CONSTRAINT IF EXISTS skyline_student_courses_enrollment_status_check;

ALTER TABLE public.skyline_student_courses
  ADD CONSTRAINT skyline_student_courses_enrollment_status_check
  CHECK (enrollment_status IN ('tentative', 'in_progress', 'suspended', 'cancelled', 'completed'));

-- Soft date-order constraint only where dates are present and valid
ALTER TABLE public.skyline_student_courses
  DROP CONSTRAINT IF EXISTS skyline_student_courses_date_order_check;

ALTER TABLE public.skyline_student_courses
  ADD CONSTRAINT skyline_student_courses_date_order_check
  CHECK (
    start_date IS NULL
    OR end_date IS NULL
    OR start_date <= end_date
  );

-- ---------------------------------------------------------------------------
-- 2. Helpers (used by trigger + preflight)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skyline_course_ranges_overlap(
  a_start DATE,
  a_end DATE,
  b_start DATE,
  b_end DATE
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT a_start IS NOT NULL
    AND a_end IS NOT NULL
    AND b_start IS NOT NULL
    AND b_end IS NOT NULL
    AND a_start <= b_end
    AND a_end >= b_start;
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill existing active enrolments BEFORE unique index / validation trigger
-- ---------------------------------------------------------------------------
-- Step A: derive dates from mapped assessment instances where missing
WITH instance_stats AS (
  SELECT
    sc.student_id,
    sc.course_id,
    MIN(fi.start_date::date) FILTER (WHERE fi.start_date IS NOT NULL) AS earliest_instance_start,
    MAX(fi.end_date::date) FILTER (WHERE fi.end_date IS NOT NULL) AS latest_instance_end
  FROM public.skyline_student_courses sc
  LEFT JOIN public.skyline_course_forms cf ON cf.course_id = sc.course_id
  LEFT JOIN public.skyline_form_instances fi
    ON fi.form_id = cf.form_id
   AND fi.student_id = sc.student_id
  WHERE sc.status = 'active'
  GROUP BY sc.student_id, sc.course_id
)
UPDATE public.skyline_student_courses sc
SET
  start_date = COALESCE(sc.start_date, ist.earliest_instance_start),
  end_date = COALESCE(sc.end_date, ist.latest_instance_end),
  updated_at = NOW()
FROM instance_stats ist
WHERE sc.student_id = ist.student_id
  AND sc.course_id = ist.course_id
  AND sc.status = 'active'
  AND (sc.start_date IS NULL OR sc.end_date IS NULL);

-- Step B: temporarily set all non-terminal active rows to tentative (clears multi in_progress)
UPDATE public.skyline_student_courses
SET
  enrollment_status = 'tentative',
  enrollment_status_changed_at = COALESCE(enrollment_status_changed_at, NOW()),
  updated_at = NOW()
WHERE status = 'active'
  AND enrollment_status NOT IN ('completed', 'suspended', 'cancelled');

-- Step C: pick one In Progress per student via earliest instance ranking
WITH ranked AS (
  SELECT
    sc.student_id,
    sc.course_id,
    ROW_NUMBER() OVER (
      PARTITION BY sc.student_id
      ORDER BY
        CASE WHEN ist.earliest_instance_start IS NOT NULL THEN 0 ELSE 1 END,
        ist.earliest_instance_start ASC NULLS LAST,
        ist.earliest_instance_end ASC NULLS LAST,
        ist.earliest_instance_created_at ASC NULLS LAST,
        sc.created_at ASC NULLS LAST,
        sc.course_id ASC
    ) AS rnk
  FROM public.skyline_student_courses sc
  LEFT JOIN (
    SELECT
      sc2.student_id,
      sc2.course_id,
      MIN(fi.start_date::date) FILTER (WHERE fi.start_date IS NOT NULL) AS earliest_instance_start,
      MIN(fi.end_date::date) FILTER (WHERE fi.end_date IS NOT NULL) AS earliest_instance_end,
      MIN(fi.created_at) AS earliest_instance_created_at
    FROM public.skyline_student_courses sc2
    LEFT JOIN public.skyline_course_forms cf ON cf.course_id = sc2.course_id
    LEFT JOIN public.skyline_form_instances fi
      ON fi.form_id = cf.form_id AND fi.student_id = sc2.student_id
    WHERE sc2.status = 'active'
    GROUP BY sc2.student_id, sc2.course_id
  ) ist ON ist.student_id = sc.student_id AND ist.course_id = sc.course_id
  WHERE sc.status = 'active'
    AND sc.enrollment_status = 'tentative'
)
UPDATE public.skyline_student_courses sc
SET
  enrollment_status = 'in_progress',
  enrollment_status_changed_at = COALESCE(sc.enrollment_status_changed_at, NOW()),
  updated_at = NOW()
FROM ranked r
WHERE sc.student_id = r.student_id
  AND sc.course_id = r.course_id
  AND r.rnk = 1
  AND sc.status = 'active'
  AND sc.enrollment_status = 'tentative';

-- Safety: no NULL lifecycle on active rows
UPDATE public.skyline_student_courses
SET enrollment_status = COALESCE(NULLIF(enrollment_status, ''), 'in_progress')
WHERE status = 'active'
  AND (enrollment_status IS NULL OR enrollment_status = '');

-- ---------------------------------------------------------------------------
-- 4. One In Progress unique index (after backfill)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS skyline_student_courses_one_in_progress_uidx
  ON public.skyline_student_courses (student_id)
  WHERE status = 'active' AND enrollment_status = 'in_progress';

-- ---------------------------------------------------------------------------
-- 5. Validation trigger (future writes only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skyline_validate_student_course_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflict_course_id BIGINT;
  v_conflict_name TEXT;
  v_conflict_code TEXT;
  v_other_in_progress BIGINT;
BEGIN
  IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL AND NEW.start_date > NEW.end_date THEN
    RAISE EXCEPTION 'Course end date cannot be before the course start date.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = 'active' AND NEW.enrollment_status = 'in_progress' THEN
    SELECT sc.course_id INTO v_other_in_progress
    FROM public.skyline_student_courses sc
    WHERE sc.student_id = NEW.student_id
      AND sc.status = 'active'
      AND sc.enrollment_status = 'in_progress'
      AND sc.course_id IS DISTINCT FROM NEW.course_id
    LIMIT 1;
    IF v_other_in_progress IS NOT NULL THEN
      RAISE EXCEPTION 'This student already has another course in progress. Complete, cancel or suspend the current course before starting this course.'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  IF NEW.status = 'active'
     AND NEW.enrollment_status IS DISTINCT FROM 'cancelled'
     AND NEW.start_date IS NOT NULL
     AND NEW.end_date IS NOT NULL
  THEN
    SELECT sc.course_id, c.name, c.qualification_code
      INTO v_conflict_course_id, v_conflict_name, v_conflict_code
    FROM public.skyline_student_courses sc
    JOIN public.skyline_courses c ON c.id = sc.course_id
    WHERE sc.student_id = NEW.student_id
      AND sc.status = 'active'
      AND sc.enrollment_status IS DISTINCT FROM 'cancelled'
      AND sc.course_id IS DISTINCT FROM NEW.course_id
      AND sc.start_date IS NOT NULL
      AND sc.end_date IS NOT NULL
      AND public.skyline_course_ranges_overlap(sc.start_date, sc.end_date, NEW.start_date, NEW.end_date)
    LIMIT 1;

    IF v_conflict_course_id IS NOT NULL THEN
      RAISE EXCEPTION 'Course dates overlap with % — %.',
        COALESCE(NULLIF(TRIM(v_conflict_code), ''), 'course'),
        COALESCE(v_conflict_name, 'another course')
        USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.enrollment_status IS DISTINCT FROM OLD.enrollment_status THEN
    NEW.enrollment_status_changed_at := NOW();
    IF NEW.enrollment_status_changed_by IS NULL THEN
      NEW.enrollment_status_changed_by := NEW.updated_by;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.enrollment_status_changed_at IS NULL THEN
    NEW.enrollment_status_changed_at := COALESCE(NEW.created_at, NOW());
    IF NEW.enrollment_status_changed_by IS NULL THEN
      NEW.enrollment_status_changed_by := COALESCE(NEW.created_by, NEW.updated_by);
    END IF;
  END IF;

  NEW.updated_at := COALESCE(NEW.updated_at, NOW());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skyline_validate_student_course_row ON public.skyline_student_courses;
CREATE TRIGGER trg_skyline_validate_student_course_row
  BEFORE INSERT OR UPDATE ON public.skyline_student_courses
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_validate_student_course_row();

-- ---------------------------------------------------------------------------
-- 6. Atomic upsert / update RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skyline_upsert_student_course_enrollment(
  p_student_id BIGINT,
  p_course_id BIGINT,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_enrollment_status TEXT DEFAULT NULL,
  p_intake_label TEXT DEFAULT NULL,
  p_link_status TEXT DEFAULT 'active',
  p_completed_at DATE DEFAULT NULL,
  p_actor_user_id BIGINT DEFAULT NULL,
  p_allow_create BOOLEAN DEFAULT TRUE,
  p_clear_dates BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.skyline_student_courses%ROWTYPE;
  v_status TEXT;
  v_prev_status TEXT;
  v_has_in_progress BOOLEAN;
  v_in_progress_course_id BIGINT;
  v_in_progress_name TEXT;
  v_start DATE;
  v_end DATE;
BEGIN
  IF p_student_id IS NULL OR p_course_id IS NULL OR p_student_id <= 0 OR p_course_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid student or course.');
  END IF;

  PERFORM pg_advisory_xact_lock(872314001, (p_student_id % 2147483647)::INT);

  SELECT * INTO v_existing
  FROM public.skyline_student_courses
  WHERE student_id = p_student_id AND course_id = p_course_id
  FOR UPDATE;

  IF NOT FOUND AND NOT p_allow_create THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enrolment not found.');
  END IF;

  v_prev_status := COALESCE(v_existing.enrollment_status, 'tentative');
  v_status := COALESCE(NULLIF(TRIM(p_enrollment_status), ''), v_existing.enrollment_status, 'tentative');

  IF v_status NOT IN ('tentative', 'in_progress', 'suspended', 'cancelled', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid course status.');
  END IF;

  IF FOUND AND v_status IS DISTINCT FROM v_prev_status THEN
    IF NOT (
      (v_prev_status = 'tentative' AND v_status IN ('in_progress', 'cancelled'))
      OR (v_prev_status = 'in_progress' AND v_status IN ('suspended', 'completed', 'cancelled'))
      OR (v_prev_status = 'suspended' AND v_status IN ('in_progress', 'completed', 'cancelled'))
      OR (v_prev_status = v_status)
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format('Cannot change course status from %s to %s.', v_prev_status, v_status)
      );
    END IF;
  END IF;

  IF p_clear_dates THEN
    v_start := p_start_date;
    v_end := p_end_date;
  ELSE
    v_start := COALESCE(p_start_date, v_existing.start_date);
    v_end := COALESCE(p_end_date, v_existing.end_date);
  END IF;

  IF v_status = 'in_progress' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.skyline_student_courses sc
      WHERE sc.student_id = p_student_id
        AND sc.status = 'active'
        AND sc.enrollment_status = 'in_progress'
        AND sc.course_id IS DISTINCT FROM p_course_id
    ) INTO v_has_in_progress;

    IF v_has_in_progress THEN
      SELECT sc.course_id, c.name INTO v_in_progress_course_id, v_in_progress_name
      FROM public.skyline_student_courses sc
      JOIN public.skyline_courses c ON c.id = sc.course_id
      WHERE sc.student_id = p_student_id
        AND sc.status = 'active'
        AND sc.enrollment_status = 'in_progress'
        AND sc.course_id IS DISTINCT FROM p_course_id
      LIMIT 1;
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'This student already has another course in progress. Complete, cancel or suspend the current course before starting this course.',
        'blocking_course_id', v_in_progress_course_id,
        'blocking_course_name', v_in_progress_name
      );
    END IF;

    IF v_start IS NULL OR v_end IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'Valid course start and end dates are required before a course can be In Progress.'
      );
    END IF;
  END IF;

  BEGIN
    IF FOUND THEN
      UPDATE public.skyline_student_courses SET
        status = COALESCE(NULLIF(TRIM(p_link_status), ''), status, 'active'),
        start_date = CASE WHEN p_start_date IS NOT NULL OR p_clear_dates THEN p_start_date ELSE start_date END,
        end_date = CASE WHEN p_end_date IS NOT NULL OR p_clear_dates THEN p_end_date ELSE end_date END,
        enrollment_status = v_status,
        intake_label = CASE
          WHEN p_intake_label IS NULL THEN intake_label
          ELSE NULLIF(TRIM(p_intake_label), '')
        END,
        completed_at = CASE
          WHEN v_status = 'completed' THEN COALESCE(p_completed_at, end_date, CURRENT_DATE)
          WHEN v_status IN ('cancelled', 'tentative') THEN NULL
          WHEN p_completed_at IS NOT NULL THEN p_completed_at
          ELSE completed_at
        END,
        updated_by = COALESCE(p_actor_user_id, updated_by),
        enrollment_status_changed_by = CASE
          WHEN v_status IS DISTINCT FROM v_prev_status THEN COALESCE(p_actor_user_id, updated_by)
          ELSE enrollment_status_changed_by
        END,
        updated_at = NOW()
      WHERE student_id = p_student_id AND course_id = p_course_id;
    ELSE
      INSERT INTO public.skyline_student_courses (
        student_id, course_id, status, start_date, end_date, enrollment_status,
        intake_label, completed_at, created_by, updated_by,
        enrollment_status_changed_at, enrollment_status_changed_by
      ) VALUES (
        p_student_id,
        p_course_id,
        COALESCE(NULLIF(TRIM(p_link_status), ''), 'active'),
        p_start_date,
        p_end_date,
        v_status,
        NULLIF(TRIM(COALESCE(p_intake_label, '')), ''),
        CASE WHEN v_status = 'completed' THEN COALESCE(p_completed_at, p_end_date, CURRENT_DATE) ELSE p_completed_at END,
        p_actor_user_id,
        p_actor_user_id,
        NOW(),
        p_actor_user_id
      );
    END IF;
  EXCEPTION
    WHEN unique_violation OR exclusion_violation OR check_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
    WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'student_id', p_student_id,
    'course_id', p_course_id,
    'enrollment_status', v_status,
    'previous_status', v_prev_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.skyline_upsert_student_course_enrollment FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_upsert_student_course_enrollment TO authenticated;
GRANT EXECUTE ON FUNCTION public.skyline_upsert_student_course_enrollment TO service_role;
GRANT EXECUTE ON FUNCTION public.skyline_upsert_student_course_enrollment TO anon;

-- ---------------------------------------------------------------------------
-- 7. Preflight report view (read-only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.skyline_course_lifecycle_preflight AS
WITH instance_stats AS (
  SELECT
    sc.student_id,
    sc.course_id,
    MIN(fi.start_date::date) FILTER (WHERE fi.start_date IS NOT NULL) AS earliest_instance_start,
    MIN(fi.end_date::date) FILTER (WHERE fi.end_date IS NOT NULL) AS earliest_instance_end,
    MAX(fi.end_date::date) FILTER (WHERE fi.end_date IS NOT NULL) AS latest_instance_end,
    MIN(fi.created_at) AS earliest_instance_created_at,
    COUNT(fi.id) AS instance_count
  FROM public.skyline_student_courses sc
  LEFT JOIN public.skyline_course_forms cf ON cf.course_id = sc.course_id
  LEFT JOIN public.skyline_form_instances fi
    ON fi.form_id = cf.form_id
   AND fi.student_id = sc.student_id
  WHERE sc.status = 'active'
  GROUP BY sc.student_id, sc.course_id
),
ranked AS (
  SELECT
    sc.student_id,
    sc.course_id,
    sc.status AS existing_enrolment_status,
    sc.enrollment_status AS existing_course_status,
    sc.start_date AS existing_course_start_date,
    sc.end_date AS existing_course_end_date,
    sc.created_at AS enrolment_created_at,
    s.student_id AS external_student_id,
    s.id AS internal_student_id,
    COALESCE(
      NULLIF(TRIM(s.name), ''),
      TRIM(CONCAT(COALESCE(s.first_name, ''), ' ', COALESCE(s.last_name, '')))
    ) AS student_name,
    c.qualification_code,
    c.name AS course_name,
    ist.earliest_instance_start,
    ist.earliest_instance_end,
    ist.latest_instance_end,
    ist.earliest_instance_created_at,
    COALESCE(ist.instance_count, 0) AS instance_count,
    ROW_NUMBER() OVER (
      PARTITION BY sc.student_id
      ORDER BY
        CASE WHEN ist.earliest_instance_start IS NOT NULL THEN 0 ELSE 1 END,
        ist.earliest_instance_start ASC NULLS LAST,
        ist.earliest_instance_end ASC NULLS LAST,
        ist.earliest_instance_created_at ASC NULLS LAST,
        sc.created_at ASC NULLS LAST,
        sc.course_id ASC
    ) AS calculated_course_rank,
    COUNT(*) OVER (PARTITION BY sc.student_id) AS active_course_count
  FROM public.skyline_student_courses sc
  JOIN public.skyline_students s ON s.id = sc.student_id
  JOIN public.skyline_courses c ON c.id = sc.course_id
  LEFT JOIN instance_stats ist ON ist.student_id = sc.student_id AND ist.course_id = sc.course_id
  WHERE sc.status = 'active'
)
SELECT
  r.external_student_id,
  r.internal_student_id,
  r.student_name,
  r.course_id AS enrolment_course_id,
  r.course_id,
  r.qualification_code,
  r.course_name,
  r.existing_enrolment_status,
  r.existing_course_status,
  r.existing_course_start_date,
  r.existing_course_end_date,
  r.earliest_instance_start,
  r.earliest_instance_end,
  r.latest_instance_end,
  r.instance_count,
  r.calculated_course_rank,
  r.existing_course_status AS proposed_course_status,
  r.existing_course_start_date AS proposed_course_start_date,
  r.existing_course_end_date AS proposed_course_end_date,
  CASE
    WHEN r.existing_course_status = 'completed' THEN 'Existing completed status preserved'
    WHEN r.existing_course_status = 'suspended' THEN 'Existing suspended status preserved'
    WHEN r.existing_course_status = 'cancelled' THEN 'Existing cancelled status preserved'
    WHEN r.active_course_count = 1 AND r.existing_course_status = 'in_progress'
      THEN 'Existing single active course; defaulted to In Progress'
    WHEN r.calculated_course_rank = 1 AND r.existing_course_status = 'in_progress'
      THEN 'Earliest assessment instance start date; selected as In Progress'
    WHEN r.existing_course_status = 'tentative'
      THEN 'Later assessment schedule; set to Tentative'
    ELSE 'Lifecycle status applied'
  END AS selection_reason,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.skyline_student_courses o
      WHERE o.student_id = r.student_id
        AND o.status = 'active'
        AND o.enrollment_status IS DISTINCT FROM 'cancelled'
        AND o.course_id IS DISTINCT FROM r.course_id
        AND o.start_date IS NOT NULL AND o.end_date IS NOT NULL
        AND r.existing_course_start_date IS NOT NULL AND r.existing_course_end_date IS NOT NULL
        AND public.skyline_course_ranges_overlap(
          o.start_date, o.end_date, r.existing_course_start_date, r.existing_course_end_date
        )
    ) THEN 'Existing date range overlaps another course'
    ELSE NULL
  END AS overlap_warning,
  CASE
    WHEN r.earliest_instance_start IS NOT NULL
      AND r.existing_course_start_date IS NOT NULL
      AND r.existing_course_start_date IS DISTINCT FROM r.earliest_instance_start
      THEN 'Existing course dates differ from assessment schedule'
    ELSE NULL
  END AS date_discrepancy_warning,
  CASE
    WHEN r.earliest_instance_start IS NULL AND r.active_course_count > 1
      THEN 'Manual review: chronology may be ambiguous (missing instance dates)'
    WHEN r.calculated_course_rank = 1
      AND EXISTS (
        SELECT 1 FROM ranked x
        WHERE x.student_id = r.student_id
          AND x.course_id <> r.course_id
          AND x.earliest_instance_start IS NOT DISTINCT FROM r.earliest_instance_start
          AND x.earliest_instance_end IS NOT DISTINCT FROM r.earliest_instance_end
          AND x.earliest_instance_created_at IS NOT DISTINCT FROM r.earliest_instance_created_at
      )
      THEN 'Equal assessment dates; deterministic tie-breaker used'
    ELSE NULL
  END AS manual_review_warning
FROM ranked r;

COMMENT ON VIEW public.skyline_course_lifecycle_preflight IS
  'Read-only course lifecycle backfill / schedule audit report. Does not modify data.';
