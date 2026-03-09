-- Student password authentication for generic link access
-- Enables email+password login instead of token-only links

-- Add password_hash to students (pgcrypto already enabled)
ALTER TABLE skyline_students
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Admin sets student password
CREATE OR REPLACE FUNCTION skyline_student_set_password(
  p_student_id BIGINT,
  p_password TEXT
)
RETURNS TABLE (success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_password IS NULL OR length(trim(p_password)) < 6 THEN
    RETURN QUERY SELECT FALSE, 'Password must be at least 6 characters.'::TEXT;
    RETURN;
  END IF;

  UPDATE skyline_students
  SET password_hash = crypt(trim(p_password), gen_salt('bf'))
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Student not found.'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, 'Password set successfully.'::TEXT;
END;
$$;

-- Student login: verify email+password, return student id if valid
CREATE OR REPLACE FUNCTION skyline_student_authenticate(
  p_email TEXT,
  p_password TEXT
)
RETURNS TABLE (id BIGINT, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.email
  FROM skyline_students s
  WHERE lower(trim(s.email)) = lower(trim(p_email))
    AND s.password_hash IS NOT NULL
    AND s.password_hash = crypt(p_password, s.password_hash)
    AND (s.status IS NULL OR s.status = 'active');
END;
$$;

GRANT EXECUTE ON FUNCTION skyline_student_set_password(BIGINT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION skyline_student_set_password(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION skyline_student_authenticate(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION skyline_student_authenticate(TEXT, TEXT) TO authenticated;
