-- Public international student enrolment applications (no auth — RPC access only).

CREATE TABLE IF NOT EXISTS public.student_enrolment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_no text UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  student_user_id uuid,
  first_name text,
  middle_name text,
  last_name text,
  email text,
  phone_mobile text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  agent_copy_sent boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_student_enrolment_applications_status
  ON public.student_enrolment_applications (status);
CREATE INDEX IF NOT EXISTS idx_student_enrolment_applications_email
  ON public.student_enrolment_applications (lower(email));
CREATE INDEX IF NOT EXISTS idx_student_enrolment_applications_created
  ON public.student_enrolment_applications (created_at DESC);

ALTER TABLE public.student_enrolment_applications ENABLE ROW LEVEL SECURITY;

-- No direct anon/authenticated policies — clients use SECURITY DEFINER RPCs below.

CREATE OR REPLACE FUNCTION public.skyline_enrolment_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_enrolment_applications_updated ON public.student_enrolment_applications;
CREATE TRIGGER trg_student_enrolment_applications_updated
  BEFORE UPDATE ON public.student_enrolment_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_enrolment_touch_updated_at();

CREATE OR REPLACE FUNCTION public.skyline_enrolment_next_application_no()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_day text := to_char(now() AT TIME ZONE 'Australia/Melbourne', 'YYYYMMDD');
  v_seq int;
BEGIN
  SELECT COUNT(*)::int + 1 INTO v_seq
  FROM public.student_enrolment_applications
  WHERE application_no LIKE 'SLIT-' || v_day || '-%';
  RETURN 'SLIT-' || v_day || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_student_enrolment_create_draft()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.student_enrolment_applications (status)
  VALUES ('draft')
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
BEGIN
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_id');
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

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_student_enrolment_submit(
  p_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_email text,
  p_phone_mobile text,
  p_payload jsonb,
  p_files jsonb,
  p_agent_copy_sent boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_no text;
BEGIN
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_id');
  END IF;

  SELECT application_no INTO v_no
  FROM public.student_enrolment_applications
  WHERE id = p_id;

  IF v_no IS NULL OR trim(v_no) = '' THEN
    v_no := public.skyline_enrolment_next_application_no();
  END IF;

  UPDATE public.student_enrolment_applications
  SET
    application_no = v_no,
    status = 'submitted',
    submitted_at = now(),
    first_name = nullif(trim(p_first_name), ''),
    middle_name = nullif(trim(p_middle_name), ''),
    last_name = nullif(trim(p_last_name), ''),
    email = nullif(lower(trim(p_email)), ''),
    phone_mobile = nullif(trim(p_phone_mobile), ''),
    payload = COALESCE(p_payload, '{}'::jsonb),
    files = COALESCE(p_files, '[]'::jsonb),
    agent_copy_sent = COALESCE(p_agent_copy_sent, false)
  WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'application_no', v_no);
END;
$$;

REVOKE ALL ON FUNCTION public.skyline_student_enrolment_create_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.skyline_student_enrolment_save_draft(uuid, text, text, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.skyline_student_enrolment_submit(uuid, text, text, text, text, text, jsonb, jsonb, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.skyline_student_enrolment_create_draft() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skyline_student_enrolment_save_draft(uuid, text, text, text, text, text, jsonb, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skyline_student_enrolment_submit(uuid, text, text, text, text, text, jsonb, jsonb, boolean) TO anon, authenticated, service_role;

-- Storage: dedicated bucket + mirror path under photomedia/admissions for existing CDN patterns.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-enrolment-documents',
  'student-enrolment-documents',
  true,
  15728640,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Anon/authenticated may upload enrolment documents (public form).
DROP POLICY IF EXISTS student_enrolment_docs_insert ON storage.objects;
CREATE POLICY student_enrolment_docs_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'student-enrolment-documents');

DROP POLICY IF EXISTS student_enrolment_docs_select ON storage.objects;
CREATE POLICY student_enrolment_docs_select ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'student-enrolment-documents');

NOTIFY pgrst, 'reload schema';
