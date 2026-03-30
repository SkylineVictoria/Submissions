-- Induction form submissions (checklist, enrolment, media consent) per student per induction window.
-- Session token issued after OTP unlock (OTP is consumed); submit uses session without re-entering OTP.

CREATE TABLE IF NOT EXISTS skyline_induction_sessions (
  id BIGSERIAL PRIMARY KEY,
  induction_id BIGINT NOT NULL REFERENCES skyline_inductions(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES skyline_students(id) ON DELETE CASCADE,
  session_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skyline_induction_sessions_token ON skyline_induction_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_skyline_induction_sessions_induction_student
  ON skyline_induction_sessions(induction_id, student_id);

CREATE TABLE IF NOT EXISTS skyline_induction_submissions (
  id BIGSERIAL PRIMARY KEY,
  induction_id BIGINT NOT NULL REFERENCES skyline_inductions(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES skyline_students(id) ON DELETE CASCADE,
  student_email TEXT NOT NULL,
  payload JSONB NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (induction_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_skyline_induction_submissions_induction ON skyline_induction_submissions(induction_id);
CREATE INDEX IF NOT EXISTS idx_skyline_induction_submissions_student ON skyline_induction_submissions(student_id);

ALTER TABLE skyline_induction_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skyline_induction_submissions ENABLE ROW LEVEL SECURITY;

-- Unlock: verify OTP (or dev bypass), issue session token (replaces any prior session for this student+induction).
CREATE OR REPLACE FUNCTION skyline_induction_unlock(p_access_token UUID, p_email TEXT, p_otp TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_induction_id BIGINT;
  v_student_id BIGINT;
  v_student_email TEXT;
  v_token UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_access_token IS NULL OR p_email IS NULL OR p_otp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing access token, email, or OTP.');
  END IF;

  SELECT id INTO v_induction_id FROM skyline_inductions WHERE access_token = p_access_token;
  IF v_induction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid induction link.');
  END IF;

  -- Dev bypass — must match app-side VITE_INDUCTION_OTP_BYPASS usage; student row must exist.
  IF lower(trim(p_email)) = 'gourav.gupta@siyanainfo.com' AND trim(p_otp) = '1111' THEN
    SELECT s.id, s.email INTO v_student_id, v_student_email
    FROM skyline_students s
    WHERE lower(s.email) = lower(trim(p_email))
      AND (s.status IS NULL OR s.status = 'active')
    LIMIT 1;
    IF v_student_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Student not found.');
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
  WHERE induction_id = v_induction_id AND student_id = v_student_id;

  v_expires := now() + interval '8 hours';
  INSERT INTO skyline_induction_sessions (induction_id, student_id, expires_at)
  VALUES (v_induction_id, v_student_id, v_expires)
  RETURNING session_token INTO v_token;

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
  v_payload JSONB;
BEGIN
  IF p_access_token IS NULL OR p_session_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing token.');
  END IF;

  SELECT i.id, ses.student_id INTO v_induction_id, v_student_id
  FROM skyline_induction_sessions ses
  INNER JOIN skyline_inductions i ON i.id = ses.induction_id AND i.access_token = p_access_token
  WHERE ses.session_token = p_session_token
    AND ses.expires_at > now()
  LIMIT 1;

  IF v_induction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired or invalid. Please verify again.');
  END IF;

  SELECT sub.payload INTO v_payload
  FROM skyline_induction_submissions sub
  WHERE sub.induction_id = v_induction_id AND sub.student_id = v_student_id
  LIMIT 1;

  IF v_payload IS NULL THEN
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
  v_email TEXT;
  v_new_id BIGINT;
BEGIN
  IF p_access_token IS NULL OR p_session_token IS NULL OR p_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing data.');
  END IF;

  IF jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid payload.');
  END IF;

  SELECT i.id, ses.student_id INTO v_induction_id, v_student_id
  FROM skyline_induction_sessions ses
  INNER JOIN skyline_inductions i ON i.id = ses.induction_id AND i.access_token = p_access_token
  WHERE ses.session_token = p_session_token
    AND ses.expires_at > now()
  LIMIT 1;

  IF v_induction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired or invalid. Please verify again.');
  END IF;

  SELECT email INTO v_email FROM skyline_students WHERE id = v_student_id;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Student record missing.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM skyline_induction_submissions
    WHERE induction_id = v_induction_id AND student_id = v_student_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You have already submitted this induction.');
  END IF;

  INSERT INTO skyline_induction_submissions (induction_id, student_id, student_email, payload)
  VALUES (v_induction_id, v_student_id, v_email, p_payload)
  RETURNING id INTO v_new_id;

  IF v_new_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not save submission.');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION skyline_induction_unlock(UUID, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION skyline_induction_unlock(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION skyline_induction_submission_state(UUID, UUID) TO anon;
GRANT EXECUTE ON FUNCTION skyline_induction_submission_state(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION skyline_induction_submit(UUID, UUID, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION skyline_induction_submit(UUID, UUID, JSONB) TO authenticated;

COMMENT ON TABLE skyline_induction_submissions IS 'Student induction checklist + enrolment + media consent JSON payload; one row per student per induction window.';
COMMENT ON TABLE skyline_induction_sessions IS 'Short-lived token after OTP unlock for submitting induction without re-entering OTP.';
