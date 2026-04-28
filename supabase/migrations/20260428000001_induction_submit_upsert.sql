-- Allow re-submitting induction to update existing record (payload + submitted_at).
-- Also returns the submission id so clients can optionally use it for stable storage foldering.

CREATE OR REPLACE FUNCTION skyline_induction_submit(p_access_token UUID, p_session_token UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_induction_id BIGINT;
  v_student_id BIGINT;
  v_guest_email TEXT;
  v_email TEXT;
  v_submission_id BIGINT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_updated BOOLEAN := false;
BEGIN
  IF p_access_token IS NULL OR p_session_token IS NULL OR p_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing data.');
  END IF;

  IF jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid payload.');
  END IF;

  SELECT i.id, ses.student_id, ses.guest_email, i.start_at, i.end_at
  INTO v_induction_id, v_student_id, v_guest_email, v_start, v_end
  FROM skyline_induction_sessions ses
  INNER JOIN skyline_inductions i ON i.id = ses.induction_id AND i.access_token = p_access_token
  WHERE ses.session_token = p_session_token
    AND ses.expires_at > now()
  LIMIT 1;

  IF v_induction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired or invalid. Please verify again.');
  END IF;

  IF now() < v_start OR now() > v_end THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This induction is not open for submission at this time.');
  END IF;

  IF v_student_id IS NOT NULL THEN
    SELECT s.email INTO v_email FROM skyline_students s WHERE s.id = v_student_id;
    IF v_email IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Student record missing.');
    END IF;

    SELECT id INTO v_submission_id
    FROM skyline_induction_submissions
    WHERE induction_id = v_induction_id AND student_id = v_student_id
    LIMIT 1;

    IF v_submission_id IS NULL THEN
      INSERT INTO skyline_induction_submissions (induction_id, student_id, guest_email, student_email, payload)
      VALUES (v_induction_id, v_student_id, NULL, v_email, p_payload)
      RETURNING id INTO v_submission_id;
    ELSE
      UPDATE skyline_induction_submissions
      SET payload = p_payload,
          submitted_at = now(),
          student_email = v_email
      WHERE id = v_submission_id;
      v_updated := true;
    END IF;
  ELSE
    v_email := lower(trim(v_guest_email));
    IF v_email IS NULL OR length(v_email) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Invalid session.');
    END IF;

    SELECT id INTO v_submission_id
    FROM skyline_induction_submissions
    WHERE induction_id = v_induction_id
      AND guest_email IS NOT NULL
      AND lower(trim(guest_email)) = v_email
    LIMIT 1;

    IF v_submission_id IS NULL THEN
      INSERT INTO skyline_induction_submissions (induction_id, student_id, guest_email, student_email, payload)
      VALUES (v_induction_id, NULL, v_email, v_email, p_payload)
      RETURNING id INTO v_submission_id;
    ELSE
      UPDATE skyline_induction_submissions
      SET payload = p_payload,
          submitted_at = now(),
          student_email = v_email,
          guest_email = v_email
      WHERE id = v_submission_id;
      v_updated := true;
    END IF;
  END IF;

  IF v_submission_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not save submission.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_submission_id, 'updated', v_updated);
END;
$$;

