-- Allow staff to change induction window end time after the link is created (access_token unchanged).

CREATE OR REPLACE FUNCTION skyline_admin_patch_induction_end_at(
  p_induction_id bigint,
  p_end_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz;
BEGIN
  IF p_induction_id IS NULL OR p_end_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing induction id or end time.');
  END IF;

  SELECT start_at INTO v_start FROM skyline_inductions WHERE id = p_induction_id;
  IF v_start IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Induction not found.');
  END IF;

  IF p_end_at <= v_start THEN
    RETURN jsonb_build_object('ok', false, 'error', 'End time must be after start time.');
  END IF;

  UPDATE skyline_inductions
  SET end_at = p_end_at
  WHERE id = p_induction_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION skyline_admin_patch_induction_end_at(bigint, timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION skyline_admin_patch_induction_end_at(bigint, timestamptz) TO authenticated;

COMMENT ON FUNCTION skyline_admin_patch_induction_end_at(bigint, timestamptz)
IS 'Admin: update induction window end_at; link (access_token) stays the same.';
