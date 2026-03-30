-- Admin dashboard aggregate stats for assessments + users.
-- Provides totals, workflow counts, and top pending breakdowns for students/trainers.

CREATE OR REPLACE FUNCTION skyline_admin_dashboard_stats(
  p_start_at timestamptz DEFAULT NULL,
  p_end_at timestamptz DEFAULT NULL,
  p_status text DEFAULT 'all'
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

  v_pending_by_student jsonb;
  v_pending_by_trainer jsonb;
BEGIN
  -- Totals (all-time, not time-filtered)
  SELECT COUNT(*)::int INTO v_total_students FROM skyline_students;
  SELECT COUNT(*)::int INTO v_total_trainers FROM skyline_users WHERE role = 'trainer';
  SELECT COUNT(*)::int INTO v_total_admins FROM skyline_users WHERE role = 'admin';
  SELECT COUNT(*)::int INTO v_total_assessments FROM skyline_form_instances WHERE student_id IS NOT NULL;

  -- Workflow counts for the filtered time/status slice.
  WITH filtered AS (
    SELECT i.*
    FROM skyline_form_instances i
    WHERE i.student_id IS NOT NULL
      AND (p_start_at IS NULL OR i.created_at >= p_start_at)
      AND (p_end_at IS NULL OR i.created_at <= p_end_at)
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

  -- Top pending by student (Awaiting Student = draft)
  WITH filtered AS (
    SELECT i.*
    FROM skyline_form_instances i
    WHERE i.student_id IS NOT NULL
      AND (p_start_at IS NULL OR i.created_at >= p_start_at)
      AND (p_end_at IS NULL OR i.created_at <= p_end_at)
      AND (
        p_status = 'all'
        OR (p_status = 'awaiting_student' AND i.status = 'draft')
        OR (p_status = 'awaiting_trainer' AND i.role_context = 'trainer' AND i.status <> 'locked')
        OR (p_status = 'awaiting_office' AND i.role_context = 'office' AND i.status <> 'locked')
        OR (p_status = 'completed' AND i.status = 'locked')
      )
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  INTO v_pending_by_student
  FROM (
    SELECT
      s.id AS student_id,
      COALESCE(NULLIF(TRIM(s.name), ''), CONCAT_WS(' ', NULLIF(TRIM(s.first_name), ''), NULLIF(TRIM(s.last_name), ''))) AS student_name,
      s.email AS student_email,
      COUNT(*)::int AS pending_count
    FROM filtered f
    JOIN skyline_students s ON s.id = f.student_id
    WHERE f.status = 'draft'
    GROUP BY s.id, s.name, s.first_name, s.last_name, s.email
    ORDER BY COUNT(*) DESC, s.id DESC
    LIMIT 10
  ) t;

  -- Top pending by trainer (Awaiting Trainer = role_context trainer and not locked)
  WITH filtered AS (
    SELECT i.*
    FROM skyline_form_instances i
    WHERE i.student_id IS NOT NULL
      AND (p_start_at IS NULL OR i.created_at >= p_start_at)
      AND (p_end_at IS NULL OR i.created_at <= p_end_at)
      AND (
        p_status = 'all'
        OR (p_status = 'awaiting_student' AND i.status = 'draft')
        OR (p_status = 'awaiting_trainer' AND i.role_context = 'trainer' AND i.status <> 'locked')
        OR (p_status = 'awaiting_office' AND i.role_context = 'office' AND i.status <> 'locked')
        OR (p_status = 'completed' AND i.status = 'locked')
      )
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  INTO v_pending_by_trainer
  FROM (
    SELECT
      u.id AS trainer_id,
      u.full_name AS trainer_name,
      u.email AS trainer_email,
      COUNT(*)::int AS pending_count
    FROM filtered f
    JOIN skyline_students s ON s.id = f.student_id
    JOIN skyline_batches b ON b.id = s.batch_id
    JOIN skyline_users u ON u.id = b.trainer_id
    WHERE f.role_context = 'trainer' AND f.status <> 'locked'
    GROUP BY u.id, u.full_name, u.email
    ORDER BY COUNT(*) DESC, u.id DESC
    LIMIT 10
  ) t;

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
    ),
    'top_pending_by_student', v_pending_by_student,
    'top_pending_by_trainer', v_pending_by_trainer
  );
END;
$$;

GRANT EXECUTE ON FUNCTION skyline_admin_dashboard_stats(timestamptz, timestamptz, text) TO anon;
GRANT EXECUTE ON FUNCTION skyline_admin_dashboard_stats(timestamptz, timestamptz, text) TO authenticated;

COMMENT ON FUNCTION skyline_admin_dashboard_stats(timestamptz, timestamptz, text)
IS 'Admin dashboard aggregate stats: totals, workflow counts, top pending by student/trainer with optional created_at range + status filter.';

