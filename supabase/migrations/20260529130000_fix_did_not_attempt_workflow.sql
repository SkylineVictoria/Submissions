-- Terminal "did not attempt" rows must not appear as "Waiting Office".
-- Backfill inconsistent rows, lock them as failed, and tighten workflow filters.

-- 0) workflow_status is optional on older deployments; ensure column + 'failed' value when missing.
ALTER TABLE public.skyline_form_instances
  ADD COLUMN IF NOT EXISTS workflow_status TEXT DEFAULT 'draft';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'skyline_form_instances'
      AND column_name = 'workflow_status'
  ) THEN
    BEGIN
      ALTER TABLE public.skyline_form_instances
        DROP CONSTRAINT IF EXISTS skyline_form_instances_workflow_status_check;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    BEGIN
      ALTER TABLE public.skyline_form_instances
        DROP CONSTRAINT IF EXISTS skyline_form_instances_workflow_status_check1;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    ALTER TABLE public.skyline_form_instances
      DROP CONSTRAINT IF EXISTS skyline_form_instances_workflow_status_check;

    ALTER TABLE public.skyline_form_instances
      ADD CONSTRAINT skyline_form_instances_workflow_status_check
      CHECK (workflow_status IN ('draft', 'waiting_trainer', 'waiting_office', 'completed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_skyline_form_instances_workflow_status
  ON public.skyline_form_instances(workflow_status);

-- 1) Repair existing rows left in office queue after missed-all-attempt rollover or manual date edits.
UPDATE public.skyline_form_instances
SET
  status = 'locked',
  workflow_status = 'failed'
WHERE COALESCE(did_not_attempt, false) = true
  AND (
    status IS DISTINCT FROM 'locked'
    OR workflow_status IS DISTINCT FROM 'failed'
  );

-- 2) Rollover: when all attempt windows are missed, mark terminal failed state (not an active office queue item).
CREATE OR REPLACE FUNCTION public.skyline_sync_no_attempt_rollover(p_instance_ids bigint[])
RETURNS TABLE (
  id bigint,
  end_date date,
  no_attempt_rollovers integer,
  did_not_attempt boolean,
  role_context text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_mel date := (now() AT TIME ZONE 'Australia/Melbourne')::date;
  r record;
BEGIN
  UPDATE public.skyline_form_instances sfi
  SET
    end_date = sfi.end_date + 5,
    no_attempt_rollovers = sfi.no_attempt_rollovers + 1
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND COALESCE(sfi.did_not_attempt, false) = false
    AND COALESCE(sfi.submission_count, 0) = 0
    AND sfi.status = 'draft'
    AND sfi.role_context = 'student'
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) < 2;

  FOR r IN
    UPDATE public.skyline_form_instances sfi
    SET
      end_date = sfi.end_date + 5,
      no_attempt_rollovers = sfi.no_attempt_rollovers + 1,
      role_context = 'student',
      status = 'draft'
    WHERE
      sfi.id = ANY(p_instance_ids)
      AND COALESCE(sfi.did_not_attempt, false) = false
      AND sfi.end_date IS NOT NULL
      AND today_mel > sfi.end_date
      AND COALESCE(sfi.no_attempt_rollovers, 0) < 2
      AND (
        (
          sfi.role_context = 'student'
          AND sfi.status = 'draft'
          AND COALESCE(sfi.submission_count, 0) IN (1, 2)
        )
        OR (
          sfi.role_context = 'trainer'
          AND sfi.status = 'submitted'
          AND COALESCE(sfi.submission_count, 0) = 1
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.skyline_form_assessment_summary_data s
        WHERE s.instance_id = sfi.id
          AND s.final_attempt_1_result = 'not_yet_competent'
          AND s.final_attempt_2_result IS NULL
      )
    RETURNING sfi.id AS iid, sfi.end_date AS new_end, sfi.trainer_nyc_assessed_on_1 AS nyc1
  LOOP
    UPDATE public.skyline_form_assessment_summary_data s
    SET final_attempt_2_result = 'not_yet_competent'
    WHERE s.instance_id = r.iid
      AND s.final_attempt_2_result IS NULL;

    UPDATE public.skyline_form_results_data rd
    SET
      second_attempt_satisfactory = 'ns',
      second_attempt_date = COALESCE(
        NULLIF(TRIM(COALESCE(rd.second_attempt_date, '')), ''),
        to_char(COALESCE(r.nyc1, r.new_end - 5), 'YYYY-MM-DD')
      )
    WHERE rd.instance_id = r.iid
      AND rd.second_attempt_satisfactory IS NULL;
  END LOOP;

  UPDATE public.skyline_form_instances sfi
  SET
    end_date = sfi.end_date + 5,
    no_attempt_rollovers = sfi.no_attempt_rollovers + 1,
    role_context = 'student',
    status = 'draft'
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND COALESCE(sfi.did_not_attempt, false) = false
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) < 2
    AND sfi.role_context = 'student'
    AND sfi.status = 'draft'
    AND COALESCE(sfi.submission_count, 0) IN (2, 3)
    AND EXISTS (
      SELECT 1
      FROM public.skyline_form_assessment_summary_data s
      WHERE s.instance_id = sfi.id
        AND s.final_attempt_1_result = 'not_yet_competent'
        AND s.final_attempt_2_result = 'not_yet_competent'
        AND s.final_attempt_3_result IS NULL
    );

  UPDATE public.skyline_instance_access_tokens t
  SET
    expires_at = (((sfi.end_date + 1)::timestamp - interval '1 millisecond') AT TIME ZONE 'Australia/Melbourne'),
    revoked_at = NULL
  FROM public.skyline_form_instances sfi
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND t.instance_id = sfi.id
    AND t.role_context = 'student'
    AND t.consumed_at IS NULL;

  UPDATE public.skyline_form_instances sfi
  SET
    did_not_attempt = true,
    role_context = 'office',
    status = 'locked',
    workflow_status = 'failed'
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND COALESCE(sfi.did_not_attempt, false) = false
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) >= 2
    AND (
      (sfi.role_context = 'student' AND sfi.status = 'draft')
      OR (sfi.role_context = 'trainer' AND sfi.status = 'submitted')
    )
    AND (
      COALESCE(sfi.submission_count, 0) = 0
      OR EXISTS (
        SELECT 1
        FROM public.skyline_form_assessment_summary_data s
        WHERE s.instance_id = sfi.id
          AND s.final_attempt_1_result = 'not_yet_competent'
          AND s.final_attempt_2_result IS NULL
          AND COALESCE(sfi.submission_count, 0) IN (1, 2)
      )
      OR EXISTS (
        SELECT 1
        FROM public.skyline_form_assessment_summary_data s
        WHERE s.instance_id = sfi.id
          AND s.final_attempt_1_result = 'not_yet_competent'
          AND s.final_attempt_2_result = 'not_yet_competent'
          AND s.final_attempt_3_result IS NULL
          AND COALESCE(sfi.submission_count, 0) IN (2, 3)
      )
    );

  RETURN QUERY
  SELECT
    sfi.id,
    sfi.end_date,
    COALESCE(sfi.no_attempt_rollovers, 0),
    COALESCE(sfi.did_not_attempt, false),
    sfi.role_context,
    sfi.status
  FROM public.skyline_form_instances sfi
  WHERE sfi.id = ANY(p_instance_ids);
END;
$$;

-- 3) Assessment directory workflow filters.
CREATE OR REPLACE FUNCTION public.skyline_list_submitted_instances_paged(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_search text DEFAULT NULL,
  p_course_id bigint DEFAULT NULL,
  p_form_id bigint DEFAULT NULL,
  p_student_id bigint DEFAULT NULL,
  p_active_on date DEFAULT NULL,
  p_workflow_status text DEFAULT NULL,
  p_start_from date DEFAULT NULL,
  p_start_to date DEFAULT NULL,
  p_sort_key text DEFAULT 'created',
  p_sort_dir text DEFAULT 'desc'
)
RETURNS TABLE (
  id bigint,
  form_id bigint,
  form_name text,
  form_version text,
  student_id bigint,
  student_name text,
  student_email text,
  status text,
  role_context text,
  created_at timestamptz,
  submitted_at timestamptz,
  submission_count integer,
  start_date date,
  end_date date,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_from integer := GREATEST(0, (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 20));
  v_limit integer := GREATEST(1, COALESCE(p_page_size, 20));
  v_dir text := CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_key text := lower(COALESCE(p_sort_key, 'created'));
  v_sql text;
BEGIN
  v_sql := $q$
    WITH base AS (
      SELECT
        i.id,
        i.form_id,
        f.name AS form_name,
        f.version AS form_version,
        i.student_id,
        COALESCE(
          NULLIF(trim(concat_ws(' ', NULLIF(s.first_name,''), NULLIF(s.last_name,''))), ''),
          NULLIF(s.name,''),
          s.email,
          'Unknown student'
        ) AS student_name,
        COALESCE(s.email, '') AS student_email,
        i.status,
        i.role_context,
        i.created_at,
        i.submitted_at,
        COALESCE(i.submission_count, 0)::int AS submission_count,
        i.start_date,
        i.end_date
      FROM public.skyline_form_instances i
      JOIN public.skyline_forms f ON f.id = i.form_id
      JOIN public.skyline_students s ON s.id = i.student_id
      WHERE i.student_id IS NOT NULL
        AND (s.status IS NULL OR s.status = 'active')
        AND ($1::bigint IS NULL OR i.form_id = $1::bigint)
        AND ($2::bigint IS NULL OR i.student_id = $2::bigint)
        AND (
          $3::bigint IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.skyline_course_forms cf
            WHERE cf.course_id = $3::bigint
              AND cf.form_id = i.form_id
          )
        )
        AND (
          COALESCE($4::text, '') = ''
          OR (
            i.status ILIKE ('%' || $4::text || '%')
            OR i.role_context ILIKE ('%' || $4::text || '%')
            OR f.name ILIKE ('%' || $4::text || '%')
            OR COALESCE(f.version,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.student_id,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.first_name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.last_name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.email,'') ILIKE ('%' || $4::text || '%')
          )
        )
        AND (
          $5::date IS NULL
          OR (
            i.start_date IS NOT NULL
            AND i.start_date <= $5::date
            AND (i.end_date IS NULL OR i.end_date >= $5::date)
          )
        )
        AND (
          $6::text IS NULL
          OR trim(BOTH FROM $6::text) = ''
          OR lower(trim(BOTH FROM $6::text)) = 'all'
          OR (
            lower(trim(BOTH FROM $6::text)) = 'awaiting_student'
            AND i.status = 'draft'
            AND NOT COALESCE(i.did_not_attempt, false)
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'awaiting_trainer'
            AND i.role_context = 'trainer'
            AND i.status <> 'locked'
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'awaiting_office'
            AND i.role_context = 'office'
            AND i.status <> 'locked'
            AND NOT COALESCE(i.did_not_attempt, false)
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'did_not_attempt'
            AND COALESCE(i.did_not_attempt, false) = true
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'completed'
            AND i.status = 'locked'
            AND NOT COALESCE(i.did_not_attempt, false)
          )
        )
        AND (
          $7::date IS NULL
          OR (i.start_date IS NOT NULL AND i.start_date >= $7::date)
        )
        AND (
          $8::date IS NULL
          OR (i.start_date IS NOT NULL AND i.start_date <= $8::date)
        )
    )
    SELECT
      b.*,
      COUNT(*) OVER() AS total_count
    FROM base b
  $q$;

  IF v_key = 'student' THEN
    v_sql := v_sql || format(' ORDER BY b.student_name %s, b.student_email %s, b.id %s ', v_dir, v_dir, v_dir);
  ELSIF v_key = 'form' THEN
    v_sql := v_sql || format(' ORDER BY b.form_name %s, b.form_version %s, b.id %s ', v_dir, v_dir, v_dir);
  ELSIF v_key = 'start' THEN
    v_sql := v_sql || format(' ORDER BY b.start_date %s NULLS LAST, b.id %s ', v_dir, v_dir);
  ELSIF v_key = 'end' THEN
    v_sql := v_sql || format(' ORDER BY b.end_date %s NULLS LAST, b.id %s ', v_dir, v_dir);
  ELSIF v_key = 'workflow' THEN
    v_sql := v_sql || format(' ORDER BY b.role_context %s, b.status %s, b.id %s ', v_dir, v_dir, v_dir);
  ELSE
    v_sql := v_sql || format(' ORDER BY b.created_at %s, b.id %s ', v_dir, v_dir);
  END IF;

  v_sql := v_sql || ' LIMIT $9 OFFSET $10 ';

  RETURN QUERY EXECUTE v_sql
    USING
      p_form_id,
      p_student_id,
      p_course_id,
      NULLIF(trim(COALESCE(p_search,'')), ''),
      p_active_on,
      p_workflow_status,
      p_start_from,
      p_start_to,
      v_limit,
      v_from;
END;
$$;

-- 4) Admin dashboard stats: exclude terminal did-not-attempt from office/completed buckets.
CREATE OR REPLACE FUNCTION public.skyline_admin_dashboard_stats_v2(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_status text DEFAULT 'awaiting_student',
  p_batch_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_assessments int;
  v_total_students int;
  v_total_trainers int;
  v_total_admins int;

  v_awaiting_student int;
  v_awaiting_trainer int;
  v_awaiting_office int;
  v_completed int;
BEGIN
  SELECT COUNT(*)::int
  INTO v_total_students
  FROM skyline_students s
  WHERE s.status IS NULL OR s.status = 'active';

  SELECT COUNT(*)::int INTO v_total_trainers FROM skyline_users WHERE role = 'trainer';
  SELECT COUNT(*)::int INTO v_total_admins FROM skyline_users WHERE role IN ('admin', 'superadmin');

  SELECT COUNT(*)::int
  INTO v_total_assessments
  FROM skyline_form_instances i
  JOIN skyline_students s ON s.id = i.student_id
  WHERE i.student_id IS NOT NULL
    AND (s.status IS NULL OR s.status = 'active');

  WITH filtered AS (
    SELECT i.*
    FROM skyline_form_instances i
    JOIN skyline_students s ON s.id = i.student_id
    WHERE i.student_id IS NOT NULL
      AND (s.status IS NULL OR s.status = 'active')
      AND (p_batch_id IS NULL OR s.batch_id = p_batch_id)
      AND (
        p_from_date IS NULL OR p_to_date IS NULL
        OR (i.start_date IS NOT NULL AND i.start_date BETWEEN p_from_date AND p_to_date)
        OR (i.end_date IS NOT NULL AND i.end_date BETWEEN p_from_date AND p_to_date)
      )
      AND (
        p_status = 'all'
        OR (p_status = 'awaiting_student' AND i.status = 'draft' AND NOT COALESCE(i.did_not_attempt, false))
        OR (p_status = 'awaiting_trainer' AND i.role_context = 'trainer' AND i.status <> 'locked')
        OR (p_status = 'awaiting_office' AND i.role_context = 'office' AND i.status <> 'locked' AND NOT COALESCE(i.did_not_attempt, false))
        OR (p_status = 'did_not_attempt' AND COALESCE(i.did_not_attempt, false) = true)
        OR (p_status = 'completed' AND i.status = 'locked' AND NOT COALESCE(i.did_not_attempt, false))
      )
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'draft' AND NOT COALESCE(did_not_attempt, false))::int,
    COUNT(*) FILTER (WHERE role_context = 'trainer' AND status <> 'locked')::int,
    COUNT(*) FILTER (WHERE role_context = 'office' AND status <> 'locked' AND NOT COALESCE(did_not_attempt, false))::int,
    COUNT(*) FILTER (WHERE status = 'locked' AND NOT COALESCE(did_not_attempt, false))::int
  INTO v_awaiting_student, v_awaiting_trainer, v_awaiting_office, v_completed
  FROM filtered;

  RETURN jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'assessments', v_total_assessments,
      'students', v_total_students,
      'trainers', v_total_trainers,
      'admins', v_total_admins
    ),
    'workflow', jsonb_build_object(
      'awaiting_student', COALESCE(v_awaiting_student, 0),
      'awaiting_trainer', COALESCE(v_awaiting_trainer, 0),
      'awaiting_office', COALESCE(v_awaiting_office, 0),
      'completed', COALESCE(v_completed, 0)
    )
  );
END;
$$;

-- 5) Admin dashboard instance list filters.
CREATE OR REPLACE FUNCTION public.skyline_admin_dashboard_instances_paged(
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 20,
  p_status text DEFAULT 'awaiting_student',
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_batch_id bigint DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  form_id bigint,
  form_name text,
  form_version text,
  student_id bigint,
  student_name text,
  student_email text,
  status text,
  role_context text,
  start_date date,
  end_date date,
  created_at timestamptz,
  batch_id bigint,
  batch_name text,
  trainer_name text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_from integer := GREATEST(0, (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 20));
  v_limit integer := GREATEST(1, COALESCE(p_page_size, 20));
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      i.id,
      i.form_id,
      f.name AS form_name,
      f.version AS form_version,
      i.student_id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', NULLIF(s.first_name,''), NULLIF(s.last_name,''))), ''),
        NULLIF(s.name,''),
        s.email,
        'Unknown student'
      ) AS student_name,
      COALESCE(s.email, '') AS student_email,
      i.status,
      i.role_context,
      i.start_date,
      i.end_date,
      i.created_at,
      s.batch_id,
      b.name AS batch_name,
      u.full_name AS trainer_name
    FROM public.skyline_form_instances i
    JOIN public.skyline_forms f ON f.id = i.form_id
    JOIN public.skyline_students s ON s.id = i.student_id
    LEFT JOIN public.skyline_batches b ON b.id = s.batch_id
    LEFT JOIN public.skyline_users u ON u.id = b.trainer_id
    WHERE i.student_id IS NOT NULL
      AND (s.status IS NULL OR s.status = 'active')
      AND (p_batch_id IS NULL OR s.batch_id = p_batch_id)
      AND (
        p_from_date IS NULL OR p_to_date IS NULL
        OR (i.start_date IS NOT NULL AND i.start_date BETWEEN p_from_date AND p_to_date)
        OR (i.end_date IS NOT NULL AND i.end_date BETWEEN p_from_date AND p_to_date)
      )
      AND (
        p_status = 'all'
        OR (p_status = 'awaiting_student' AND i.status = 'draft' AND NOT COALESCE(i.did_not_attempt, false))
        OR (p_status = 'awaiting_trainer' AND i.role_context = 'trainer' AND i.status <> 'locked')
        OR (p_status = 'awaiting_office' AND i.role_context = 'office' AND i.status <> 'locked' AND NOT COALESCE(i.did_not_attempt, false))
        OR (p_status = 'did_not_attempt' AND COALESCE(i.did_not_attempt, false) = true)
        OR (p_status = 'completed' AND i.status = 'locked' AND NOT COALESCE(i.did_not_attempt, false))
      )
  )
  SELECT
    b.*,
    COUNT(*) OVER() AS total_count
  FROM base b
  ORDER BY
    COALESCE(b.start_date, b.end_date, b.created_at::date) DESC,
    b.id DESC
  LIMIT v_limit OFFSET v_from;
END;
$$;
