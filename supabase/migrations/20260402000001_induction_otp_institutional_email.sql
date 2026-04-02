-- Induction OTP: allow any @slit.edu.au / @student.slit.edu.au address (not only rows in students/users).

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
  v_norm TEXT;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Email is required.'::TEXT;
    RETURN;
  END IF;

  v_norm := lower(trim(p_email));

  SELECT
    EXISTS(
      SELECT 1 FROM skyline_students s
      WHERE lower(trim(s.email)) = v_norm
        AND (s.status IS NULL OR s.status = 'active')
    )
    OR EXISTS(
      SELECT 1 FROM skyline_users u
      WHERE lower(trim(u.email)) = v_norm
        AND u.status = 'active'
    )
    OR v_norm ~ '@student\.slit\.edu\.au$'
    OR v_norm ~ '@slit\.edu\.au$'
  INTO v_allowed;

  IF NOT v_allowed THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Use your @student.slit.edu.au or @slit.edu.au email.'::TEXT;
    RETURN;
  END IF;

  v_otp := lpad(floor(random() * 1000000)::TEXT, 6, '0');
  v_expires := now() + interval '10 minutes';

  DELETE FROM skyline_otps WHERE lower(skyline_otps.email) = v_norm;

  INSERT INTO skyline_otps (email, otp_code, expires_at)
  VALUES (v_norm, v_otp, v_expires);

  RETURN QUERY SELECT TRUE, v_otp, 'OTP generated successfully.'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION skyline_verify_induction_otp(p_email TEXT, p_otp TEXT)
RETURNS TABLE (student_id BIGINT, guest_email TEXT, email_out TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sid BIGINT;
  v_em TEXT;
  v_norm TEXT;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 OR p_otp IS NULL OR length(trim(p_otp)) = 0 THEN
    RETURN;
  END IF;

  v_norm := lower(trim(p_email));

  IF NOT EXISTS (
    SELECT 1 FROM skyline_otps o
    WHERE lower(o.email) = v_norm
      AND o.otp_code = trim(p_otp)
      AND o.expires_at > now()
  ) THEN
    RETURN;
  END IF;

  SELECT s.id, s.email INTO v_sid, v_em
  FROM skyline_students s
  WHERE lower(trim(s.email)) = v_norm
    AND (s.status IS NULL OR s.status = 'active')
  LIMIT 1;

  IF v_sid IS NOT NULL THEN
    DELETE FROM skyline_otps
    WHERE lower(skyline_otps.email) = v_norm
      AND skyline_otps.otp_code = trim(p_otp);
    RETURN QUERY SELECT v_sid, NULL::TEXT, v_em;
    RETURN;
  END IF;

  SELECT u.email INTO v_em
  FROM skyline_users u
  WHERE lower(trim(u.email)) = v_norm
    AND u.status = 'active'
  LIMIT 1;

  IF v_em IS NOT NULL THEN
    DELETE FROM skyline_otps
    WHERE lower(skyline_otps.email) = v_norm
      AND skyline_otps.otp_code = trim(p_otp);
    RETURN QUERY SELECT NULL::BIGINT, v_norm::TEXT, v_em;
    RETURN;
  END IF;

  IF v_norm ~ '@student\.slit\.edu\.au$' OR v_norm ~ '@slit\.edu\.au$' THEN
    DELETE FROM skyline_otps
    WHERE lower(skyline_otps.email) = v_norm
      AND skyline_otps.otp_code = trim(p_otp);
    RETURN QUERY SELECT NULL::BIGINT, v_norm::TEXT, v_norm::TEXT;
    RETURN;
  END IF;

  DELETE FROM skyline_otps
  WHERE lower(skyline_otps.email) = v_norm
    AND skyline_otps.otp_code = trim(p_otp);
END;
$$;
