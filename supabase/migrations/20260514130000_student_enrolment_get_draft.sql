-- Load draft enrolment application for public form resume (anon via RPC).

CREATE OR REPLACE FUNCTION public.skyline_student_enrolment_get_draft(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.student_enrolment_applications%ROWTYPE;
BEGIN
  IF p_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_id');
  END IF;

  SELECT * INTO v_row
  FROM public.student_enrolment_applications
  WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'application_no', v_row.application_no,
    'payload', v_row.payload,
    'files', v_row.files
  );
END;
$$;

REVOKE ALL ON FUNCTION public.skyline_student_enrolment_get_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_student_enrolment_get_draft(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
