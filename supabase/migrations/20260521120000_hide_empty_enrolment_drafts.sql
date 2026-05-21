-- Do not insert or keep empty enrolment drafts (name/email/phone required).

CREATE OR REPLACE FUNCTION public.skyline_enrolment_has_meaningful_contact(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone_mobile text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(trim(p_first_name), '') IS NOT NULL
    OR NULLIF(trim(p_last_name), '') IS NOT NULL
    OR NULLIF(trim(p_email), '') IS NOT NULL
    OR NULLIF(trim(p_phone_mobile), '') IS NOT NULL,
    false
  );
$$;

DROP FUNCTION IF EXISTS public.skyline_student_enrolment_create_draft();

CREATE OR REPLACE FUNCTION public.skyline_student_enrolment_create_draft(
  p_first_name text DEFAULT NULL,
  p_middle_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone_mobile text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_files jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.skyline_enrolment_has_meaningful_contact(
    p_first_name, p_last_name, p_email, p_phone_mobile
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Enter at least your name or email before saving.'
    );
  END IF;

  INSERT INTO public.student_enrolment_applications (
    status,
    first_name,
    middle_name,
    last_name,
    email,
    phone_mobile,
    payload,
    files
  )
  VALUES (
    'draft',
    nullif(trim(p_first_name), ''),
    nullif(trim(p_middle_name), ''),
    nullif(trim(p_last_name), ''),
    nullif(lower(trim(p_email)), ''),
    nullif(trim(p_phone_mobile), ''),
    COALESCE(p_payload, '{}'::jsonb),
    COALESCE(p_files, '[]'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_student_enrolment_save_draft(
  p_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_email text,
  p_phone_mobile text,
  p_payload jsonb,
  p_files jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_id');
  END IF;

  SELECT status INTO v_status
  FROM public.student_enrolment_applications
  WHERE id = p_id;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_status = 'draft'
    AND NOT public.skyline_enrolment_has_meaningful_contact(
      p_first_name, p_last_name, p_email, p_phone_mobile
    ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Enter at least your name or email before saving.'
    );
  END IF;

  UPDATE public.student_enrolment_applications
  SET
    first_name = nullif(trim(p_first_name), ''),
    middle_name = nullif(trim(p_middle_name), ''),
    last_name = nullif(trim(p_last_name), ''),
    email = nullif(lower(trim(p_email)), ''),
    phone_mobile = nullif(trim(p_phone_mobile), ''),
    payload = COALESCE(p_payload, '{}'::jsonb),
    files = COALESCE(p_files, '[]'::jsonb),
    status = CASE WHEN status = 'submitted' THEN status ELSE 'draft' END
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

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
          AND NOT (
            a.status = 'draft'
            AND NOT public.skyline_enrolment_has_meaningful_contact(
              a.first_name, a.last_name, a.email, a.phone_mobile
            )
          )
        ORDER BY COALESCE(a.submitted_at, a.created_at) DESC
        LIMIT 500
      ) sub
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.skyline_student_enrolment_create_draft(text, text, text, text, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_student_enrolment_create_draft(text, text, text, text, text, jsonb, jsonb)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
