-- Assessment directory / reports: filter submitted instances by student batch.
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
  p_sort_dir text DEFAULT 'desc',
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
        AND (
          $9::bigint IS NULL
          OR s.batch_id = $9::bigint
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

  v_sql := v_sql || ' LIMIT $10 OFFSET $11 ';

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
      p_batch_id,
      v_limit,
      v_from;
END;
$$;
