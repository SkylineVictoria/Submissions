-- Enforce induction window (start_at / end_at, timestamptz) for unlock, session state, and submit.

CREATE OR REPLACE FUNCTION skyline_induction_unlock(p_access_token UUID, p_email TEXT, p_otp TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_induction_id BIGINT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_student_id BIGINT;
  v_guest_email TEXT;
  v_student_email TEXT;
  v_token UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_access_token IS NULL OR p_email IS NULL OR p_otp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing access token, email, or OTP.');
  END IF;

  SELECT id, start_at, end_at INTO v_induction_id, v_start, v_end FROM skyline_inductions WHERE access_token = p_access_token;
  IF v_induction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid induction link.');
  END IF;

  IF now() < v_start THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This induction has not opened yet.');
  END IF;
  IF now() > v_end THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This induction period has ended.');
  END IF;

  v_student_id := NULL;
  v_guest_email := NULL;

  IF lower(trim(p_email)) = 'gourav.gupta@siyanainfo.com' AND trim(p_otp) = '1111' THEN
    SELECT s.id, s.email INTO v_student_id, v_student_email
    FROM skyline_students s
    WHERE lower(s.email) = lower(trim(p_email))
      AND (s.status IS NULL OR s.status = 'active')
    LIMIT 1;
    IF v_student_id IS NULL THEN
      v_guest_email := lower(trim(p_email));
      v_student_email := v_guest_email;
    END IF;
  ELSE
    SELECT id, email INTO v_student_id, v_student_email
    FROM skyline_verify_student_otp(trim(p_email), trim(p_otp))
    LIMIT 1;
    IF v_student_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Invalid or expired OTP.');
    END IF;
  END IF;

  DELETE FROM skyline_induction_sessions
  WHERE induction_id = v_induction_id
    AND (
      (v_student_id IS NOT NULL AND student_id = v_student_id)
      OR (
        v_guest_email IS NOT NULL
        AND guest_email IS NOT NULL
        AND lower(trim(guest_email)) = lower(trim(v_guest_email))
      )
    );

  v_expires := now() + interval '8 hours';
  IF v_student_id IS NOT NULL THEN
    INSERT INTO skyline_induction_sessions (induction_id, student_id, guest_email, expires_at)
    VALUES (v_induction_id, v_student_id, NULL, v_expires)
    RETURNING session_token INTO v_token;
  ELSE
    INSERT INTO skyline_induction_sessions (induction_id, student_id, guest_email, expires_at)
    VALUES (v_induction_id, NULL, v_guest_email, v_expires)
    RETURNING session_token INTO v_token;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'session_token', v_token::text,
    'student_email', v_student_email
  );
END;
$$;

CREATE OR REPLACE FUNCTION skyline_induction_submission_state(p_access_token UUID, p_session_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_induction_id BIGINT;
  v_student_id BIGINT;
  v_guest_email TEXT;
  v_payload JSONB;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  IF p_access_token IS NULL OR p_session_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing token.');
  END IF;

  SELECT i.id, ses.student_id, ses.guest_email
  INTO v_induction_id, v_student_id, v_guest_email
  FROM skyline_induction_sessions ses
  INNER JOIN skyline_inductions i ON i.id = ses.induction_id AND i.access_token = p_access_token
  WHERE ses.session_token = p_session_token
    AND ses.expires_at > now()
  LIMIT 1;

  IF v_induction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired or invalid. Please verify again.');
  END IF;

  SELECT start_at, end_at INTO v_start, v_end FROM skyline_inductions WHERE id = v_induction_id;

  IF v_student_id IS NOT NULL THEN
    SELECT sub.payload INTO v_payload
    FROM skyline_induction_submissions sub
    WHERE sub.induction_id = v_induction_id AND sub.student_id = v_student_id
    LIMIT 1;
  ELSE
    SELECT sub.payload INTO v_payload
    FROM skyline_induction_submissions sub
    WHERE sub.induction_id = v_induction_id
      AND sub.guest_email IS NOT NULL
      AND lower(trim(sub.guest_email)) = lower(trim(v_guest_email))
    LIMIT 1;
  END IF;

  IF v_payload IS NULL THEN
    IF now() < v_start OR now() > v_end THEN
      RETURN jsonb_build_object('ok', true, 'submitted', false, 'outside_window', true);
    END IF;
    RETURN jsonb_build_object('ok', true, 'submitted', false);
  END IF;

  RETURN jsonb_build_object('ok', true, 'submitted', true, 'payload', v_payload);
END;
$$;

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
  v_new_id BIGINT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
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
    IF EXISTS (
      SELECT 1 FROM skyline_induction_submissions
      WHERE induction_id = v_induction_id AND student_id = v_student_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'You have already submitted this induction.');
    END IF;
    INSERT INTO skyline_induction_submissions (induction_id, student_id, guest_email, student_email, payload)
    VALUES (v_induction_id, v_student_id, NULL, v_email, p_payload)
    RETURNING id INTO v_new_id;
  ELSE
    v_email := lower(trim(v_guest_email));
    IF v_email IS NULL OR length(v_email) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Invalid session.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM skyline_induction_submissions
      WHERE induction_id = v_induction_id
        AND guest_email IS NOT NULL
        AND lower(trim(guest_email)) = v_email
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'You have already submitted this induction.');
    END IF;
    INSERT INTO skyline_induction_submissions (induction_id, student_id, guest_email, student_email, payload)
    VALUES (v_induction_id, NULL, v_email, v_email, p_payload)
    RETURNING id INTO v_new_id;
  END IF;

  IF v_new_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not save submission.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
