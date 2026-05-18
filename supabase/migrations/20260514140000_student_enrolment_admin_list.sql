-- Admin list of student enrolment applications (custom auth — granted to anon like other admin RPCs).

CREATE OR REPLACE FUNCTION public.skyline_student_enrolment_list(
  p_name text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_status text DEFAULT NULL
)
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
          COALESCE(a.submitted_at, a.created_at) AS sort_ts,
          jsonb_build_object(
            'id', a.id,
            'application_no', a.application_no,
            'status', a.status,
            'first_name', a.first_name,
            'middle_name', a.middle_name,
            'last_name', a.last_name,
            'email', a.email,
            'phone_mobile', a.phone_mobile,
            'submitted_at', a.submitted_at,
            'created_at', a.created_at,
            'payload', a.payload,
            'files', a.files
          ) AS row_build
        FROM public.student_enrolment_applications a
        WHERE
          (p_status IS NULL OR trim(p_status) = '' OR a.status = p_status)
          AND (
            p_from IS NULL
            OR COALESCE(a.submitted_at, a.created_at) >= p_from
          )
          AND (
            p_to IS NULL
            OR COALESCE(a.submitted_at, a.created_at) <= p_to
          )
          AND (
            p_name IS NULL
            OR trim(p_name) = ''
            OR a.application_no ILIKE '%' || trim(p_name) || '%'
            OR a.first_name ILIKE '%' || trim(p_name) || '%'
            OR a.last_name ILIKE '%' || trim(p_name) || '%'
            OR a.email ILIKE '%' || trim(p_name) || '%'
          )
        ORDER BY COALESCE(a.submitted_at, a.created_at) DESC
        LIMIT 500
      ) sub
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.skyline_student_enrolment_list(text, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_student_enrolment_list(text, timestamptz, timestamptz, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
