-- Admin dashboard stats: optional batch filter (match skyline_admin_dashboard_instances_paged).

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
  -- Totals (all-time, global — unchanged for directory cards)
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

  -- Workflow counts for the filtered slice (date range + status + optional batch).
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
        OR (p_status = 'awaiting_student' AND i.status = 'draft')
        OR (p_status = 'awaiting_trainer' AND i.role_context = 'trainer' AND i.status <> 'locked')
        OR (p_status = 'awaiting_office' AND i.role_context = 'office' AND i.status <> 'locked')
        OR (p_status = 'completed' AND i.status = 'locked')
      )
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'draft')::int,
    COUNT(*) FILTER (WHERE role_context = 'trainer' AND status <> 'locked')::int,
    COUNT(*) FILTER (WHERE role_context = 'office' AND status <> 'locked')::int,
    COUNT(*) FILTER (WHERE status = 'locked')::int
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
