-- Assessment submission workflow hardening.
-- Review-only migration: do not apply to production until approved.
--
-- Key rules:
--   * assessment reads never invoke rollover;
--   * rollover is executed by pg_cron;
--   * expired drafts with saved answers are "incomplete / awaiting_submission";
--   * final submit is row-locked, audited, and idempotent per request_id.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

ALTER TABLE public.skyline_form_instances
  DROP CONSTRAINT IF EXISTS skyline_form_instances_status_check;
ALTER TABLE public.skyline_form_instances
  ADD CONSTRAINT skyline_form_instances_status_check
  CHECK (status IN ('draft', 'submitted', 'locked', 'incomplete'));

ALTER TABLE public.skyline_form_instances
  DROP CONSTRAINT IF EXISTS skyline_form_instances_workflow_status_check;
ALTER TABLE public.skyline_form_instances
  DROP CONSTRAINT IF EXISTS skyline_form_instances_workflow_status_check1;
ALTER TABLE public.skyline_form_instances
  ADD CONSTRAINT skyline_form_instances_workflow_status_check
  CHECK (workflow_status IN (
    'draft',
    'waiting_trainer',
    'waiting_office',
    'completed',
    'failed',
    'awaiting_submission'
  ));

-- Repair legacy contradictions where rollover marked an instance as
-- did-not-attempt even though a trainer recorded a competent result.
UPDATE public.skyline_form_instances i
SET
  did_not_attempt = false,
  status = CASE WHEN i.status = 'locked' THEN 'locked' ELSE 'submitted' END,
  role_context = 'office',
  workflow_status = CASE WHEN i.status = 'locked' THEN 'completed' ELSE 'waiting_office' END,
  updated_at = now()
WHERE COALESCE(i.did_not_attempt, false)
  AND EXISTS (
    SELECT 1
    FROM public.skyline_form_assessment_summary_data s
    WHERE s.instance_id = i.id
      AND 'competent' IN (
        s.final_attempt_1_result,
        s.final_attempt_2_result,
        s.final_attempt_3_result
      )
  );

-- Repair legacy terminal rows that contain saved student work. These were
-- incorrectly classified as untouched by the old rollover path.
UPDATE public.skyline_form_instances i
SET
  did_not_attempt = false,
  status = 'incomplete',
  role_context = 'student',
  workflow_status = 'awaiting_submission',
  updated_at = now()
WHERE COALESCE(i.did_not_attempt, false)
  AND COALESCE(i.submission_count, 0) = 0
  AND EXISTS (
    SELECT 1
    FROM public.skyline_form_answers a
    WHERE a.instance_id = i.id
  );

CREATE TABLE IF NOT EXISTS public.skyline_submission_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id bigint NOT NULL
    REFERENCES public.skyline_form_instances(id) ON DELETE CASCADE,
  student_id bigint
    REFERENCES public.skyline_students(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  request_id text NOT NULL,
  success boolean NOT NULL,
  error text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skyline_submission_events_request_unique
    UNIQUE (instance_id, request_id)
);

CREATE INDEX IF NOT EXISTS idx_skyline_submission_events_instance_time
  ON public.skyline_submission_events(instance_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_skyline_submission_events_student_time
  ON public.skyline_submission_events(student_id, occurred_at DESC);

ALTER TABLE public.skyline_submission_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.skyline_submission_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.skyline_submission_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.skyline_submission_events_id_seq TO service_role;

DROP FUNCTION IF EXISTS public.skyline_submit_instance_to_trainer(bigint);

CREATE OR REPLACE FUNCTION public.skyline_submit_instance_to_trainer(
  p_instance_id bigint,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_request_id text := COALESCE(NULLIF(btrim(p_request_id), ''), gen_random_uuid()::text);
  v_instance public.skyline_form_instances%ROWTYPE;
  v_previous public.skyline_submission_events%ROWTYPE;
  v_new_submitted_at timestamptz;
  v_new_count integer;
BEGIN
  SELECT *
  INTO v_previous
  FROM public.skyline_submission_events
  WHERE instance_id = p_instance_id
    AND request_id = v_request_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', v_previous.success,
      'error', v_previous.error,
      'request_id', v_request_id,
      'duplicate', true
    );
  END IF;

  SELECT *
  INTO v_instance
  FROM public.skyline_form_instances
  WHERE id = p_instance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_found',
      'request_id', v_request_id
    );
  END IF;

  -- Recheck after taking the instance lock so two concurrent calls carrying
  -- the same request id cannot both attempt to insert the unique audit row.
  SELECT *
  INTO v_previous
  FROM public.skyline_submission_events
  WHERE instance_id = p_instance_id
    AND request_id = v_request_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', v_previous.success,
      'error', v_previous.error,
      'request_id', v_request_id,
      'duplicate', true
    );
  END IF;

  -- A retry after a successful transition is a no-op, even with a new request id.
  IF COALESCE(v_instance.submission_count, 0) > 0
     AND v_instance.status = 'submitted'
     AND v_instance.role_context = 'trainer'
     AND v_instance.workflow_status = 'waiting_trainer' THEN
    INSERT INTO public.skyline_submission_events (
      instance_id, student_id, event_type, request_id, success, error, occurred_at
    ) VALUES (
      v_instance.id, v_instance.student_id, 'final_submit_duplicate',
      v_request_id, true, NULL, v_now
    );

    RETURN jsonb_build_object(
      'ok', true,
      'request_id', v_request_id,
      'duplicate', true
    );
  END IF;

  IF COALESCE(v_instance.did_not_attempt, false)
     OR v_instance.status = 'locked'
     OR v_instance.workflow_status IN ('failed', 'completed') THEN
    INSERT INTO public.skyline_submission_events (
      instance_id, student_id, event_type, request_id, success, error, occurred_at
    ) VALUES (
      v_instance.id, v_instance.student_id, 'final_submit',
      v_request_id, false, 'instance_terminal', v_now
    );

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'instance_terminal',
      'request_id', v_request_id
    );
  END IF;

  IF v_instance.status NOT IN ('draft', 'incomplete')
     OR v_instance.workflow_status NOT IN ('draft', 'awaiting_submission') THEN
    INSERT INTO public.skyline_submission_events (
      instance_id, student_id, event_type, request_id, success, error, occurred_at
    ) VALUES (
      v_instance.id, v_instance.student_id, 'final_submit',
      v_request_id, false, 'invalid_workflow_state', v_now
    );

    RETURN jsonb_build_object(
      'ok', false,
      'error', 'invalid_workflow_state',
      'request_id', v_request_id
    );
  END IF;

  v_new_submitted_at := COALESCE(v_instance.submitted_at, v_now);
  v_new_count := LEAST(GREATEST(COALESCE(v_instance.submission_count, 0) + 1, 1), 3);

  UPDATE public.skyline_form_instances
  SET
    status = 'submitted',
    role_context = 'trainer',
    workflow_status = 'waiting_trainer',
    submitted_at = v_new_submitted_at,
    submission_count = v_new_count,
    did_not_attempt = false,
    updated_at = v_now
  WHERE id = v_instance.id;

  INSERT INTO public.skyline_submission_events (
    instance_id, student_id, event_type, request_id, success, error, occurred_at
  ) VALUES (
    v_instance.id, v_instance.student_id, 'final_submit',
    v_request_id, true, NULL, v_now
  );

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'duplicate', false,
    'submission_count', v_new_count
  );
END;
$$;

COMMENT ON FUNCTION public.skyline_submit_instance_to_trainer(bigint, text) IS
  'Row-locked, audited, idempotent student final submission. request_id must be reused for retries.';

REVOKE ALL ON FUNCTION public.skyline_submit_instance_to_trainer(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_submit_instance_to_trainer(bigint, text)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.skyline_sync_no_attempt_rollover(p_instance_ids bigint[])
RETURNS TABLE (
  id bigint,
  end_date date,
  no_attempt_rollovers integer,
  did_not_attempt boolean,
  role_context text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_mel date := (now() AT TIME ZONE 'Australia/Melbourne')::date;
BEGIN
  -- First and second missed windows retain the existing five-day extension.
  UPDATE public.skyline_form_instances sfi
  SET
    end_date = sfi.end_date + 5,
    no_attempt_rollovers = sfi.no_attempt_rollovers + 1
  WHERE sfi.id = ANY(p_instance_ids)
    AND NOT COALESCE(sfi.did_not_attempt, false)
    AND COALESCE(sfi.submission_count, 0) = 0
    AND sfi.status = 'draft'
    AND sfi.role_context = 'student'
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) < 2;

  -- Preserve existing NYC attempt-window behavior for assessments that have
  -- already recorded one or more final submissions.
  WITH moved AS (
    UPDATE public.skyline_form_instances sfi
    SET
      end_date = sfi.end_date + 5,
      no_attempt_rollovers = sfi.no_attempt_rollovers + 1,
      role_context = 'student',
      status = 'draft',
      workflow_status = 'draft'
    WHERE sfi.id = ANY(p_instance_ids)
      AND NOT COALESCE(sfi.did_not_attempt, false)
      AND sfi.end_date IS NOT NULL
      AND today_mel > sfi.end_date
      AND COALESCE(sfi.no_attempt_rollovers, 0) < 2
      AND (
        (
          sfi.role_context = 'student'
          AND sfi.status = 'draft'
          AND COALESCE(sfi.submission_count, 0) IN (1, 2)
        )
        OR (
          sfi.role_context = 'trainer'
          AND sfi.status = 'submitted'
          AND COALESCE(sfi.submission_count, 0) = 1
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.skyline_form_assessment_summary_data s
        WHERE s.instance_id = sfi.id
          AND s.final_attempt_1_result = 'not_yet_competent'
          AND s.final_attempt_2_result IS NULL
      )
    RETURNING sfi.id, sfi.end_date, sfi.trainer_nyc_assessed_on_1
  )
  UPDATE public.skyline_form_assessment_summary_data s
  SET final_attempt_2_result = 'not_yet_competent'
  FROM moved m
  WHERE s.instance_id = m.id
    AND s.final_attempt_2_result IS NULL;

  UPDATE public.skyline_form_results_data rd
  SET
    second_attempt_satisfactory = 'ns',
    second_attempt_date = COALESCE(
      NULLIF(btrim(COALESCE(rd.second_attempt_date, '')), ''),
      to_char(
        COALESCE(
          (
            SELECT i.trainer_nyc_assessed_on_1
            FROM public.skyline_form_instances i
            WHERE i.id = rd.instance_id
          ),
          (
            SELECT i.end_date - 5
            FROM public.skyline_form_instances i
            WHERE i.id = rd.instance_id
          )
        ),
        'YYYY-MM-DD'
      )
    )
  WHERE rd.instance_id = ANY(p_instance_ids)
    AND rd.second_attempt_satisfactory IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.skyline_form_assessment_summary_data s
      WHERE s.instance_id = rd.instance_id
        AND s.final_attempt_2_result = 'not_yet_competent'
    );

  UPDATE public.skyline_form_instances sfi
  SET
    end_date = sfi.end_date + 5,
    no_attempt_rollovers = sfi.no_attempt_rollovers + 1,
    role_context = 'student',
    status = 'draft',
    workflow_status = 'draft'
  WHERE sfi.id = ANY(p_instance_ids)
    AND NOT COALESCE(sfi.did_not_attempt, false)
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) < 2
    AND sfi.role_context = 'student'
    AND sfi.status = 'draft'
    AND COALESCE(sfi.submission_count, 0) IN (2, 3)
    AND EXISTS (
      SELECT 1
      FROM public.skyline_form_assessment_summary_data s
      WHERE s.instance_id = sfi.id
        AND s.final_attempt_1_result = 'not_yet_competent'
        AND s.final_attempt_2_result = 'not_yet_competent'
        AND s.final_attempt_3_result IS NULL
    );

  UPDATE public.skyline_instance_access_tokens t
  SET
    expires_at = (
      ((sfi.end_date + 1)::timestamp - interval '1 millisecond')
      AT TIME ZONE 'Australia/Melbourne'
    ),
    revoked_at = NULL
  FROM public.skyline_form_instances sfi
  WHERE sfi.id = ANY(p_instance_ids)
    AND t.instance_id = sfi.id
    AND t.role_context = 'student'
    AND t.consumed_at IS NULL;

  -- A draft with saved work is not "did not attempt". It is incomplete and
  -- awaiting an explicit submission/admin decision.
  UPDATE public.skyline_form_instances sfi
  SET
    status = 'incomplete',
    workflow_status = 'awaiting_submission',
    did_not_attempt = false
  WHERE sfi.id = ANY(p_instance_ids)
    AND NOT COALESCE(sfi.did_not_attempt, false)
    AND COALESCE(sfi.submission_count, 0) = 0
    AND sfi.status = 'draft'
    AND sfi.role_context = 'student'
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) >= 2
    AND EXISTS (
      SELECT 1
      FROM public.skyline_form_answers a
      WHERE a.instance_id = sfi.id
    );

  -- Only a genuinely untouched instance becomes terminal "did not attempt".
  UPDATE public.skyline_form_instances sfi
  SET
    did_not_attempt = true,
    role_context = 'office',
    status = 'locked',
    workflow_status = 'failed'
  WHERE sfi.id = ANY(p_instance_ids)
    AND NOT COALESCE(sfi.did_not_attempt, false)
    AND COALESCE(sfi.submission_count, 0) = 0
    AND sfi.status = 'draft'
    AND sfi.role_context = 'student'
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) >= 2
    AND NOT EXISTS (
      SELECT 1
      FROM public.skyline_form_answers a
      WHERE a.instance_id = sfi.id
    );

  -- Existing submitted/NYC workflows still terminate when the next required
  -- submission window is missed. Saved answers from prior attempts do not
  -- count as a new final submission.
  UPDATE public.skyline_form_instances sfi
  SET
    did_not_attempt = true,
    role_context = 'office',
    status = 'locked',
    workflow_status = 'failed'
  WHERE sfi.id = ANY(p_instance_ids)
    AND NOT COALESCE(sfi.did_not_attempt, false)
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) >= 2
    AND (
      (sfi.role_context = 'student' AND sfi.status = 'draft')
      OR (sfi.role_context = 'trainer' AND sfi.status = 'submitted')
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.skyline_form_assessment_summary_data s
        WHERE s.instance_id = sfi.id
          AND s.final_attempt_1_result = 'not_yet_competent'
          AND s.final_attempt_2_result IS NULL
          AND COALESCE(sfi.submission_count, 0) IN (1, 2)
      )
      OR EXISTS (
        SELECT 1
        FROM public.skyline_form_assessment_summary_data s
        WHERE s.instance_id = sfi.id
          AND s.final_attempt_1_result = 'not_yet_competent'
          AND s.final_attempt_2_result = 'not_yet_competent'
          AND s.final_attempt_3_result IS NULL
          AND COALESCE(sfi.submission_count, 0) IN (2, 3)
      )
    );

  RETURN QUERY
  SELECT
    sfi.id,
    sfi.end_date,
    COALESCE(sfi.no_attempt_rollovers, 0),
    COALESCE(sfi.did_not_attempt, false),
    sfi.role_context,
    sfi.status
  FROM public.skyline_form_instances sfi
  WHERE sfi.id = ANY(p_instance_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.skyline_sync_no_attempt_rollover(bigint[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skyline_sync_no_attempt_rollover(bigint[])
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.skyline_run_scheduled_no_attempt_rollover()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  SELECT COALESCE(array_agg(i.id ORDER BY i.id), ARRAY[]::bigint[])
  INTO v_ids
  FROM public.skyline_form_instances i
  WHERE NOT COALESCE(i.did_not_attempt, false)
    AND i.end_date IS NOT NULL
    AND (now() AT TIME ZONE 'Australia/Melbourne')::date > i.end_date
    AND (
      (i.status = 'draft' AND i.role_context = 'student')
      OR (i.status = 'submitted' AND i.role_context = 'trainer')
    );

  IF cardinality(v_ids) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM *
  FROM public.skyline_sync_no_attempt_rollover(v_ids);

  RETURN cardinality(v_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.skyline_run_scheduled_no_attempt_rollover()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skyline_run_scheduled_no_attempt_rollover()
  TO service_role, postgres;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'skyline-assessment-no-attempt-rollover';

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'skyline-assessment-no-attempt-rollover',
    '*/15 * * * *',
    'SELECT public.skyline_run_scheduled_no_attempt_rollover();'
  );
END;
$$;
