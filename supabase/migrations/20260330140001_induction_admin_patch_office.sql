-- Admin: merge office-use-only fields into submission payload (enrolment.office*).
-- SECURITY DEFINER — same pattern as skyline_admin_list_induction_submissions.

CREATE OR REPLACE FUNCTION skyline_admin_patch_induction_submission_office(
  p_submission_id bigint,
  p_office jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean jsonb;
BEGIN
  IF p_submission_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing submission id.');
  END IF;

  v_clean := jsonb_build_object(
    'officeSmsBy', COALESCE(trim(p_office->>'officeSmsBy'), ''),
    'officeSmsDate', COALESCE(trim(p_office->>'officeSmsDate'), ''),
    'officePrismsBy', COALESCE(trim(p_office->>'officePrismsBy'), ''),
    'officePrismsDate', COALESCE(trim(p_office->>'officePrismsDate'), '')
  );

  UPDATE skyline_induction_submissions
  SET payload = jsonb_set(
    payload,
    '{enrolment}',
    COALESCE(payload->'enrolment', '{}'::jsonb) || v_clean,
    true
  )
  WHERE id = p_submission_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Submission not found.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION skyline_admin_patch_induction_submission_office(bigint, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION skyline_admin_patch_induction_submission_office(bigint, jsonb) TO authenticated;

COMMENT ON FUNCTION skyline_admin_patch_induction_submission_office(bigint, jsonb) IS 'Staff: update office-use fields on an induction submission payload.';
