-- Atomic student → trainer handoff: avoids partial client updates where submitted_at/submission_count
-- persisted while status stayed draft and role_context stayed student (split JS updates / retries).

CREATE OR REPLACE FUNCTION public.skyline_submit_instance_to_trainer(p_instance_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_old_submitted_at timestamptz;
  v_old_count int;
  v_new_submitted_at timestamptz;
  v_new_count int;
BEGIN
  SELECT submitted_at, COALESCE(submission_count, 0)
  INTO v_old_submitted_at, v_old_count
  FROM public.skyline_form_instances
  WHERE id = p_instance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_old_submitted_at IS NULL THEN
    v_new_submitted_at := v_now;
    v_new_count := GREATEST(1, v_old_count);
  ELSE
    v_new_submitted_at := v_old_submitted_at;
    v_new_count := LEAST(GREATEST(v_old_count, 1) + 1, 3);
  END IF;

  UPDATE public.skyline_form_instances
  SET
    status = 'submitted',
    role_context = 'trainer',
    submitted_at = v_new_submitted_at,
    submission_count = v_new_count,
    updated_at = v_now
  WHERE id = p_instance_id;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'skyline_form_instances'
      AND c.column_name = 'workflow_status'
  ) THEN
    EXECUTE 'UPDATE public.skyline_form_instances SET workflow_status = $1 WHERE id = $2'
      USING 'waiting_trainer', p_instance_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.skyline_submit_instance_to_trainer(bigint) IS
  'Single-row atomic update for student submission into trainer queue (status, role_context, submitted_at, submission_count).';

REVOKE ALL ON FUNCTION public.skyline_submit_instance_to_trainer(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_submit_instance_to_trainer(bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.skyline_submit_instance_to_trainer(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skyline_submit_instance_to_trainer(bigint) TO service_role;
