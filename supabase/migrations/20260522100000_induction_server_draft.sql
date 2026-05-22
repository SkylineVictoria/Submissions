-- Server-side induction drafts: save progress before final submit; resume after OTP on any device.

ALTER TABLE public.skyline_induction_submissions
  ALTER COLUMN submitted_at DROP NOT NULL,
  ALTER COLUMN submitted_at DROP DEFAULT;

ALTER TABLE public.skyline_induction_submissions
  ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.skyline_induction_submissions.submitted_at IS
  'NULL while draft only; set on final Submit induction.';
COMMENT ON COLUMN public.skyline_induction_submissions.draft_updated_at IS
  'Last Save draft (or auto-save) timestamp.';

CREATE OR REPLACE FUNCTION public.skyline_induction_save_draft(
  p_access_token UUID,
  p_session_token UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_induction_id BIGINT;
  v_student_id BIGINT;
  v_guest_email TEXT;
  v_email TEXT;
  v_submission_id BIGINT;
  v_submitted_at TIMESTAMPTZ;
BEGIN
  IF p_access_token IS NULL OR p_session_token IS NULL OR p_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing data.');
  END IF;

  IF jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid payload.');
  END IF;

  SELECT i.id, ses.student_id, ses.guest_email
  INTO v_induction_id, v_student_id, v_guest_email
  FROM public.skyline_induction_sessions ses
  INNER JOIN public.skyline_inductions i ON i.id = ses.induction_id
    AND i.access_token = p_access_token
    AND i.deleted_at IS NULL
  WHERE ses.session_token = p_session_token
    AND ses.expires_at > now()
  LIMIT 1;

  IF v_induction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired or invalid. Please verify again.');
  END IF;

  IF v_student_id IS NOT NULL THEN
    SELECT s.email INTO v_email FROM public.skyline_students s WHERE s.id = v_student_id;
    IF v_email IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Student record missing.');
    END IF;

    SELECT id, submitted_at INTO v_submission_id, v_submitted_at
    FROM public.skyline_induction_submissions
    WHERE induction_id = v_induction_id AND student_id = v_student_id
    LIMIT 1;

    IF v_submitted_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'This induction has already been submitted.');
    END IF;

    IF v_submission_id IS NULL THEN
      INSERT INTO public.skyline_induction_submissions (
        induction_id, student_id, guest_email, student_email, payload, submitted_at, draft_updated_at
      )
      VALUES (v_induction_id, v_student_id, NULL, v_email, p_payload, NULL, now())
      RETURNING id INTO v_submission_id;
    ELSE
      UPDATE public.skyline_induction_submissions
      SET payload = p_payload,
          draft_updated_at = now(),
          student_email = v_email
      WHERE id = v_submission_id;
    END IF;
  ELSE
    v_email := lower(trim(v_guest_email));
    IF v_email IS NULL OR length(v_email) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Invalid session.');
    END IF;

    SELECT id, submitted_at INTO v_submission_id, v_submitted_at
    FROM public.skyline_induction_submissions
    WHERE induction_id = v_induction_id
      AND guest_email IS NOT NULL
      AND lower(trim(guest_email)) = v_email
    LIMIT 1;

    IF v_submitted_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'This induction has already been submitted.');
    END IF;

    IF v_submission_id IS NULL THEN
      INSERT INTO public.skyline_induction_submissions (
        induction_id, student_id, guest_email, student_email, payload, submitted_at, draft_updated_at
      )
      VALUES (v_induction_id, NULL, v_email, v_email, p_payload, NULL, now())
      RETURNING id INTO v_submission_id;
    ELSE
      UPDATE public.skyline_induction_submissions
      SET payload = p_payload,
          draft_updated_at = now(),
          student_email = v_email,
          guest_email = v_email
      WHERE id = v_submission_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_submission_id, 'saved_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_induction_submission_state(p_access_token UUID, p_session_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_induction_id BIGINT;
  v_student_id BIGINT;
  v_guest_email TEXT;
  v_payload JSONB;
  v_submitted_at TIMESTAMPTZ;
  v_draft_updated_at TIMESTAMPTZ;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  IF p_access_token IS NULL OR p_session_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing token.');
  END IF;

  SELECT i.id, ses.student_id, ses.guest_email
  INTO v_induction_id, v_student_id, v_guest_email
  FROM public.skyline_induction_sessions ses
  INNER JOIN public.skyline_inductions i ON i.id = ses.induction_id
    AND i.access_token = p_access_token
    AND i.deleted_at IS NULL
  WHERE ses.session_token = p_session_token
    AND ses.expires_at > now()
  LIMIT 1;

  IF v_induction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired or invalid. Please verify again.');
  END IF;

  SELECT start_at, end_at INTO v_start, v_end
  FROM public.skyline_inductions
  WHERE id = v_induction_id AND deleted_at IS NULL;

  IF v_start IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired or invalid. Please verify again.');
  END IF;

  IF v_student_id IS NOT NULL THEN
    SELECT sub.payload, sub.submitted_at, sub.draft_updated_at
    INTO v_payload, v_submitted_at, v_draft_updated_at
    FROM public.skyline_induction_submissions sub
    WHERE sub.induction_id = v_induction_id AND sub.student_id = v_student_id
    LIMIT 1;
  ELSE
    SELECT sub.payload, sub.submitted_at, sub.draft_updated_at
    INTO v_payload, v_submitted_at, v_draft_updated_at
    FROM public.skyline_induction_submissions sub
    WHERE sub.induction_id = v_induction_id
      AND sub.guest_email IS NOT NULL
      AND lower(trim(sub.guest_email)) = lower(trim(v_guest_email))
    LIMIT 1;
  END IF;

  IF v_payload IS NULL THEN
    IF now() < v_start OR now() > v_end THEN
      RETURN jsonb_build_object('ok', true, 'submitted', false, 'outside_window', true);
    END IF;
    RETURN jsonb_build_object('ok', true, 'submitted', false);
  END IF;

  IF v_submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'submitted', true, 'payload', v_payload);
  END IF;

  IF now() < v_start OR now() > v_end THEN
    RETURN jsonb_build_object(
      'ok', true,
      'submitted', false,
      'draft_payload', v_payload,
      'draft_saved_at', v_draft_updated_at,
      'outside_window', true
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'submitted', false,
    'draft_payload', v_payload,
    'draft_saved_at', v_draft_updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_induction_submit(p_access_token UUID, p_session_token UUID, p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_induction_id BIGINT;
  v_student_id BIGINT;
  v_guest_email TEXT;
  v_email TEXT;
  v_submission_id BIGINT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_updated BOOLEAN := false;
BEGIN
  IF p_access_token IS NULL OR p_session_token IS NULL OR p_payload IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Missing data.');
  END IF;

  IF jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid payload.');
  END IF;

  SELECT i.id, ses.student_id, ses.guest_email, i.start_at, i.end_at
  INTO v_induction_id, v_student_id, v_guest_email, v_start, v_end
  FROM public.skyline_induction_sessions ses
  INNER JOIN public.skyline_inductions i ON i.id = ses.induction_id
    AND i.access_token = p_access_token
    AND i.deleted_at IS NULL
  WHERE ses.session_token = p_session_token
    AND ses.expires_at > now()
  LIMIT 1;

  IF v_induction_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session expired or invalid. Please verify again.');
  END IF;

  IF now() < v_start OR now() > v_end THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This induction is not open for submission at this time.');
  END IF;

  IF v_student_id IS NOT NULL THEN
    SELECT s.email INTO v_email FROM public.skyline_students s WHERE s.id = v_student_id;
    IF v_email IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Student record missing.');
    END IF;

    SELECT id INTO v_submission_id
    FROM public.skyline_induction_submissions
    WHERE induction_id = v_induction_id AND student_id = v_student_id
    LIMIT 1;

    IF v_submission_id IS NULL THEN
      INSERT INTO public.skyline_induction_submissions (
        induction_id, student_id, guest_email, student_email, payload, submitted_at, draft_updated_at
      )
      VALUES (v_induction_id, v_student_id, NULL, v_email, p_payload, now(), now())
      RETURNING id INTO v_submission_id;
    ELSE
      UPDATE public.skyline_induction_submissions
      SET payload = p_payload,
          submitted_at = now(),
          draft_updated_at = now(),
          student_email = v_email
      WHERE id = v_submission_id;
      v_updated := true;
    END IF;
  ELSE
    v_email := lower(trim(v_guest_email));
    IF v_email IS NULL OR length(v_email) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Invalid session.');
    END IF;

    SELECT id INTO v_submission_id
    FROM public.skyline_induction_submissions
    WHERE induction_id = v_induction_id
      AND guest_email IS NOT NULL
      AND lower(trim(guest_email)) = v_email
    LIMIT 1;

    IF v_submission_id IS NULL THEN
      INSERT INTO public.skyline_induction_submissions (
        induction_id, student_id, guest_email, student_email, payload, submitted_at, draft_updated_at
      )
      VALUES (v_induction_id, NULL, v_email, v_email, p_payload, now(), now())
      RETURNING id INTO v_submission_id;
    ELSE
      UPDATE public.skyline_induction_submissions
      SET payload = p_payload,
          submitted_at = now(),
          draft_updated_at = now(),
          student_email = v_email,
          guest_email = v_email
      WHERE id = v_submission_id;
      v_updated := true;
    END IF;
  END IF;

  IF v_submission_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Could not save submission.');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_submission_id, 'updated', v_updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_admin_count_induction_submissions(p_induction_id bigint)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COUNT(*)::int
     FROM public.skyline_induction_submissions
     WHERE induction_id = p_induction_id
       AND submitted_at IS NOT NULL),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.skyline_admin_list_induction_submissions(p_induction_id bigint)
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
        FROM public.skyline_induction_submissions s
        WHERE s.induction_id = p_induction_id
          AND s.submitted_at IS NOT NULL
      ) sub
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.skyline_induction_save_draft(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_induction_save_draft(UUID, UUID, JSONB)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
