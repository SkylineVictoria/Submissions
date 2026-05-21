-- One draft per email: create_draft updates existing draft row instead of inserting a duplicate.

DELETE FROM public.student_enrolment_applications a
USING (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lower(trim(email))
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM public.student_enrolment_applications
  WHERE status = 'draft'
    AND email IS NOT NULL
    AND trim(email) <> ''
) d
WHERE a.id = d.id
  AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_enrolment_draft_email
  ON public.student_enrolment_applications (lower(trim(email)))
  WHERE status = 'draft'
    AND email IS NOT NULL
    AND trim(email) <> '';

CREATE OR REPLACE FUNCTION public.skyline_student_enrolment_find_draft_by_email(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := nullif(lower(trim(p_email)), '');
  v_id uuid;
BEGIN
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_email');
  END IF;

  SELECT id INTO v_id
  FROM public.student_enrolment_applications
  WHERE status = 'draft'
    AND lower(trim(email)) = v_email
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

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
  v_email text := nullif(lower(trim(p_email)), '');
  v_id uuid;
  v_updated boolean := false;
BEGIN
  IF NOT public.skyline_enrolment_has_meaningful_contact(
    p_first_name, p_last_name, p_email, p_phone_mobile
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Enter at least your name or email before saving.'
    );
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.student_enrolment_applications
    WHERE status = 'draft'
      AND lower(trim(email)) = v_email
    ORDER BY updated_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.student_enrolment_applications
    SET
      first_name = nullif(trim(p_first_name), ''),
      middle_name = nullif(trim(p_middle_name), ''),
      last_name = nullif(trim(p_last_name), ''),
      email = v_email,
      phone_mobile = nullif(trim(p_phone_mobile), ''),
      payload = COALESCE(p_payload, '{}'::jsonb),
      files = COALESCE(p_files, '[]'::jsonb)
    WHERE id = v_id;
    v_updated := true;
  ELSE
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
      v_email,
      nullif(trim(p_phone_mobile), ''),
      COALESCE(p_payload, '{}'::jsonb),
      COALESCE(p_files, '[]'::jsonb)
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.skyline_student_enrolment_find_draft_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_student_enrolment_find_draft_by_email(text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
