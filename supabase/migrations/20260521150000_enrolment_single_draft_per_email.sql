-- One draft row per email; remove empty drafts; reuse session id when email not yet entered.

DELETE FROM public.student_enrolment_applications
WHERE status = 'draft'
  AND NOT public.skyline_enrolment_has_meaningful_contact(
    first_name, last_name, email, phone_mobile
  );

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

DROP FUNCTION IF EXISTS public.skyline_student_enrolment_create_draft();
DROP FUNCTION IF EXISTS public.skyline_student_enrolment_create_draft(
  text, text, text, text, text, jsonb, jsonb
);

CREATE OR REPLACE FUNCTION public.skyline_student_enrolment_create_draft(
  p_first_name text DEFAULT NULL,
  p_middle_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone_mobile text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_files jsonb DEFAULT '[]'::jsonb,
  p_existing_id uuid DEFAULT NULL
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
  ELSIF p_existing_id IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.student_enrolment_applications
    WHERE id = p_existing_id
      AND status = 'draft'
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

REVOKE ALL ON FUNCTION public.skyline_student_enrolment_create_draft(
  text, text, text, text, text, jsonb, jsonb, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_student_enrolment_create_draft(
  text, text, text, text, text, jsonb, jsonb, uuid
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
