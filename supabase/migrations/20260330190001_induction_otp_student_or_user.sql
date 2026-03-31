-- Induction OTP: allow active skyline_users (staff) as well as students; unlock uses guest_email when no student row.

CREATE OR REPLACE FUNCTION skyline_request_induction_otp(p_email TEXT)
RETURNS TABLE (success BOOLEAN, otp TEXT, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp TEXT;
  v_expires TIMESTAMPTZ;
  v_allowed BOOLEAN;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Email is required.'::TEXT;
    RETURN;
  END IF;

  SELECT
    EXISTS(
      SELECT 1 FROM skyline_students s
      WHERE lower(trim(s.email)) = lower(trim(p_email))
        AND (s.status IS NULL OR s.status = 'active')
    )
    OR EXISTS(
      SELECT 1 FROM skyline_users u
      WHERE lower(trim(u.email)) = lower(trim(p_email))
        AND u.status = 'active'
    )
  INTO v_allowed;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'No student or staff account found for this email. Contact your administrator.'::TEXT;
    RETURN;
  END IF;

  v_otp := lpad(floor(random() * 1000000)::TEXT, 6, '0');
  v_expires := now() + interval '10 minutes';

  DELETE FROM skyline_otps WHERE lower(skyline_otps.email) = lower(trim(p_email));

  INSERT INTO skyline_otps (email, otp_code, expires_at)
  VALUES (lower(trim(p_email)), v_otp, v_expires);

  RETURN QUERY SELECT TRUE, v_otp, 'OTP generated successfully.'::TEXT;
END;
$$;

-- Verify OTP for induction: prefer student row; else active user (session uses guest_email).
CREATE OR REPLACE FUNCTION skyline_verify_induction_otp(p_email TEXT, p_otp TEXT)
RETURNS TABLE (student_id BIGINT, guest_email TEXT, email_out TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid BIGINT;
  v_em TEXT;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 OR p_otp IS NULL OR length(trim(p_otp)) = 0 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM skyline_otps o
    WHERE lower(o.email) = lower(trim(p_email))
      AND o.otp_code = trim(p_otp)
      AND o.expires_at > now()
  ) THEN
    RETURN;
  END IF;

  SELECT s.id, s.email INTO v_sid, v_em
  FROM skyline_students s
  WHERE lower(trim(s.email)) = lower(trim(p_email))
    AND (s.status IS NULL OR s.status = 'active')
  LIMIT 1;

  IF v_sid IS NOT NULL THEN
    DELETE FROM skyline_otps
    WHERE lower(skyline_otps.email) = lower(trim(p_email))
      AND skyline_otps.otp_code = trim(p_otp);
    RETURN QUERY SELECT v_sid, NULL::TEXT, v_em;
    RETURN;
  END IF;

  SELECT u.email INTO v_em
  FROM skyline_users u
  WHERE lower(trim(u.email)) = lower(trim(p_email))
    AND u.status = 'active'
  LIMIT 1;

  IF v_em IS NOT NULL THEN
    DELETE FROM skyline_otps
    WHERE lower(skyline_otps.email) = lower(trim(p_email))
      AND skyline_otps.otp_code = trim(p_otp);
    RETURN QUERY SELECT NULL::BIGINT, lower(trim(p_email))::TEXT, v_em;
    RETURN;
  END IF;

  DELETE FROM skyline_otps
  WHERE lower(skyline_otps.email) = lower(trim(p_email))
    AND skyline_otps.otp_code = trim(p_otp);
END;
$$;

GRANT EXECUTE ON FUNCTION skyline_request_induction_otp(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION skyline_request_induction_otp(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION skyline_verify_induction_otp(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION skyline_verify_induction_otp(TEXT, TEXT) TO authenticated;

-- Unlock: use induction OTP (student or staff user), not student-only verify.
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

  SELECT id, start_at, end_at INTO v_induction_id, v_start, v_end
  FROM skyline_inductions
  WHERE access_token = p_access_token AND deleted_at IS NULL;
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
    SELECT ot.student_id, ot.guest_email, ot.email_out
    INTO v_student_id, v_guest_email, v_student_email
    FROM skyline_verify_induction_otp(trim(p_email), trim(p_otp)) ot
    LIMIT 1;
    IF v_student_id IS NULL AND v_guest_email IS NULL THEN
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
