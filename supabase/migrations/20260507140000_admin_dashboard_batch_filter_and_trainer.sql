-- Admin dashboard: add optional batch filter and return batch/trainer info.

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
  v_from integer := greatest(0, (coalesce(p_page, 1) - 1) * coalesce(p_page_size, 20));
  v_limit integer := greatest(1, coalesce(p_page_size, 20));
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
        OR (p_status = 'awaiting_student' AND i.status = 'draft')
        OR (p_status = 'awaiting_trainer' AND i.role_context = 'trainer' AND i.status <> 'locked')
        OR (p_status = 'awaiting_office' AND i.role_context = 'office' AND i.status <> 'locked')
        OR (p_status = 'completed' AND i.status = 'locked')
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

