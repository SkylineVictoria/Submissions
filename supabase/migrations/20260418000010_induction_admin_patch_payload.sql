-- Admin: replace an induction submission payload (full edit of user-entered data).
-- SECURITY DEFINER — same pattern as skyline_admin_list_induction_submissions.

CREATE OR REPLACE FUNCTION skyline_admin_patch_induction_submission_payload(
  p_submission_id bigint,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_submission_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing submission id.');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid payload.');
  END IF;
  IF COALESCE((p_payload->>'version')::int, 0) <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unsupported payload version.');
  END IF;

  UPDATE skyline_induction_submissions
  SET payload = p_payload
  WHERE id = p_submission_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Submission not found.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION skyline_admin_patch_induction_submission_payload(bigint, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION skyline_admin_patch_induction_submission_payload(bigint, jsonb) TO authenticated;

COMMENT ON FUNCTION skyline_admin_patch_induction_submission_payload(bigint, jsonb) IS 'Staff: replace full induction submission payload (admin edit).';

