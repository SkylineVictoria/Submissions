-- Admin read of induction submissions (RLS blocks direct table SELECT from anon client).
-- Callable with numeric induction id (admin UI only).

CREATE OR REPLACE FUNCTION skyline_admin_count_induction_submissions(p_induction_id bigint)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COUNT(*)::int FROM skyline_induction_submissions WHERE induction_id = p_induction_id),
    0
  );
$$;

CREATE OR REPLACE FUNCTION skyline_admin_list_induction_submissions(p_induction_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(row_build ORDER BY sort_ts DESC)
      FROM (
        SELECT
          s.submitted_at AS sort_ts,
          jsonb_build_object(
            'id', s.id,
            'student_email', s.student_email,
            'submitted_at', s.submitted_at,
            'payload', s.payload,
            'student_id', s.student_id,
            'guest_email', s.guest_email
          ) AS row_build
        FROM skyline_induction_submissions s
        WHERE s.induction_id = p_induction_id
      ) sub
    ),
    '[]'::jsonb
  );
$$;

GRANT EXECUTE ON FUNCTION skyline_admin_count_induction_submissions(bigint) TO anon;
GRANT EXECUTE ON FUNCTION skyline_admin_count_induction_submissions(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION skyline_admin_list_induction_submissions(bigint) TO anon;
GRANT EXECUTE ON FUNCTION skyline_admin_list_induction_submissions(bigint) TO authenticated;

COMMENT ON FUNCTION skyline_admin_list_induction_submissions(bigint) IS 'Returns JSON array of submission rows for an induction window (admin enrollment UI).';
