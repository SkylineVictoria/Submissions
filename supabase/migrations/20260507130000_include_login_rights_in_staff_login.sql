-- Include staff impersonation rights in login RPCs so the UI can enable
-- "Login as student/trainer" features for permitted admins.

CREATE OR REPLACE FUNCTION public.skyline_verify_otp_login(p_email TEXT, p_otp TEXT)
RETURNS TABLE (
  id BIGINT,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  status TEXT,
  role TEXT,
  can_login_as_student BOOLEAN,
  can_login_as_trainer BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.full_name,
    u.email,
    u.phone,
    u.status,
    u.role,
    COALESCE(u.can_login_as_student, false),
    COALESCE(u.can_login_as_trainer, false)
  FROM skyline_users u
  INNER JOIN skyline_otps o ON lower(o.email) = lower(trim(p_email))
    AND o.otp_code = trim(p_otp)
    AND o.expires_at > now()
  WHERE lower(u.email) = lower(trim(p_email))
    AND u.status = 'active';

  -- Delete used OTP (qualify columns to avoid ambiguity with RETURNS TABLE)
  DELETE FROM skyline_otps
  WHERE lower(skyline_otps.email) = lower(trim(p_email))
    AND skyline_otps.otp_code = trim(p_otp);
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_login(p_email TEXT, p_password TEXT DEFAULT NULL)
RETURNS TABLE (
  id BIGINT,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  status TEXT,
  role TEXT,
  can_login_as_student BOOLEAN,
  can_login_as_trainer BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Master user: bypass password check when p_password is empty or null
  IF EXISTS (
    SELECT 1 FROM skyline_users u
    WHERE lower(u.email) = lower(trim(p_email))
      AND u.status = 'active'
      AND u.is_master = true
  ) AND (p_password IS NULL OR length(trim(p_password)) = 0) THEN
    RETURN QUERY
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.phone,
      u.status,
      u.role,
      COALESCE(u.can_login_as_student, false),
      COALESCE(u.can_login_as_trainer, false)
    FROM skyline_users u
    WHERE lower(u.email) = lower(trim(p_email))
      AND u.status = 'active'
      AND u.is_master = true;
    RETURN;
  END IF;

  -- Regular login: require password
  RETURN QUERY
  SELECT
    u.id,
    u.full_name,
    u.email,
    u.phone,
    u.status,
    u.role,
    COALESCE(u.can_login_as_student, false),
    COALESCE(u.can_login_as_trainer, false)
  FROM skyline_users u
  WHERE u.email = trim(p_email)
    AND u.password_hash IS NOT NULL
    AND u.password_hash = crypt(p_password, u.password_hash)
    AND u.status = 'active';
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_verify_otp_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.skyline_login(TEXT, TEXT) TO anon;

