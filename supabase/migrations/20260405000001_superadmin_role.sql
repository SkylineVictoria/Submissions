-- Staff role: superadmin (full form management). Promote CEO; widen CHECK; RPC + stats.

ALTER TABLE skyline_users DROP CONSTRAINT IF EXISTS skyline_users_role_check;
ALTER TABLE skyline_users
  ADD CONSTRAINT skyline_users_role_check
  CHECK (role IN ('superadmin', 'admin', 'trainer', 'office'));

UPDATE skyline_users
SET role = 'superadmin'
WHERE lower(trim(email)) = lower(trim('ceo@slit.edu.au'));

CREATE OR REPLACE FUNCTION skyline_create_user(
  p_full_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_status TEXT DEFAULT 'active',
  p_role TEXT DEFAULT 'trainer',
  p_password TEXT DEFAULT NULL
)
RETURNS TABLE (id BIGINT, full_name TEXT, email TEXT, phone TEXT, status TEXT, role TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id BIGINT;
  v_created TIMESTAMPTZ;
  v_password_hash TEXT;
BEGIN
  IF p_full_name IS NULL OR length(trim(p_full_name)) = 0 THEN
    RAISE EXCEPTION 'Full name is required.';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'Email is required.';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('superadmin', 'admin', 'trainer', 'office') THEN
    RAISE EXCEPTION 'Role must be superadmin, admin, trainer, or office.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'Status must be active or inactive.';
  END IF;
  IF p_password IS NOT NULL AND length(trim(p_password)) > 0 AND length(trim(p_password)) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters.';
  END IF;

  v_password_hash := CASE
    WHEN p_password IS NOT NULL AND length(trim(p_password)) > 0
    THEN crypt(trim(p_password), gen_salt('bf'))
    ELSE crypt('ChangeMe123', gen_salt('bf'))
  END;

  INSERT INTO skyline_users (full_name, email, phone, status, role, password_hash)
  VALUES (
    trim(p_full_name),
    trim(lower(p_email)),
    NULLIF(trim(p_phone), ''),
    p_status,
    p_role,
    v_password_hash
  )
  RETURNING skyline_users.id, skyline_users.created_at INTO v_id, v_created;

  RETURN QUERY
  SELECT
    u.id,
    u.full_name,
    u.email,
    u.phone,
    u.status,
    u.role,
    u.created_at
  FROM skyline_users u
  WHERE u.id = v_id;
END;
$$;

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
  SELECT COUNT(*)::int INTO v_total_students FROM skyline_students;
  SELECT COUNT(*)::int INTO v_total_trainers FROM skyline_users WHERE role = 'trainer';
  SELECT COUNT(*)::int INTO v_total_admins FROM skyline_users WHERE role IN ('admin', 'superadmin');
  SELECT COUNT(*)::int INTO v_total_assessments FROM skyline_form_instances WHERE student_id IS NOT NULL;

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
