-- Fix: "Could not find the function public.skyline_request_student_otp(p_email) in the schema cache"
-- Run this in Supabase Dashboard → SQL Editor if Student Access "Send OTP" fails with that error.
--
-- Prerequisites: skyline_otps table and skyline_students table must exist.
-- If staff OTP login works, skyline_otps exists. Run migrations in order if needed.

-- Request OTP for student: check student exists, create OTP (valid 10 min)
CREATE OR REPLACE FUNCTION skyline_request_student_otp(p_email TEXT)
RETURNS TABLE (success BOOLEAN, otp TEXT, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_otp TEXT;
  v_expires TIMESTAMPTZ;
  v_student_exists BOOLEAN;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Email is required.'::TEXT;
    RETURN;
  END IF;

  -- Check student exists (active or no status)
  SELECT EXISTS(
    SELECT 1 FROM skyline_students s
    WHERE lower(trim(s.email)) = lower(trim(p_email))
      AND (s.status IS NULL OR s.status = 'active')
  ) INTO v_student_exists;

  IF NOT v_student_exists THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Student not found. Contact your administrator.'::TEXT;
    RETURN;
  END IF;

  -- Generate 6-digit OTP
  v_otp := lpad(floor(random() * 1000000)::TEXT, 6, '0');
  v_expires := now() + interval '10 minutes';

  -- Invalidate any existing OTPs for this email
  DELETE FROM skyline_otps WHERE lower(skyline_otps.email) = lower(trim(p_email));

  -- Insert new OTP
  INSERT INTO skyline_otps (email, otp_code, expires_at)
  VALUES (lower(trim(p_email)), v_otp, v_expires);

  RETURN QUERY SELECT TRUE, v_otp, 'OTP generated successfully.'::TEXT;
END;
$$;

-- Verify student OTP and return student id
CREATE OR REPLACE FUNCTION skyline_verify_student_otp(p_email TEXT, p_otp TEXT)
RETURNS TABLE (id BIGINT, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.email
  FROM skyline_students s
  INNER JOIN skyline_otps o ON lower(o.email) = lower(trim(p_email))
    AND o.otp_code = trim(p_otp)
    AND o.expires_at > now()
  WHERE lower(s.email) = lower(trim(p_email))
    AND (s.status IS NULL OR s.status = 'active');

  DELETE FROM skyline_otps
  WHERE lower(skyline_otps.email) = lower(trim(p_email))
    AND skyline_otps.otp_code = trim(p_otp);
END;
$$;

GRANT EXECUTE ON FUNCTION skyline_request_student_otp(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION skyline_request_student_otp(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION skyline_verify_student_otp(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION skyline_verify_student_otp(TEXT, TEXT) TO authenticated;
