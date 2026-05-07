-- Extend no-submission rollover to students who already submitted an attempt but missed the
-- next attempt window after the trainer recorded Not Yet Competent (summary sheet).

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
  -- Eligible: window ended, still with student, draft, not final did_not_attempt,
  -- at most one prior rollover, and either:
  --   (A) no submission yet, or
  --   (B) NYC on attempt N in assessment summary, next attempt not marked, and submission_count
  --       still equals N (student has not submitted the required next attempt).
  UPDATE public.skyline_form_instances sfi
  SET
    end_date = sfi.end_date + 5,
    no_attempt_rollovers = sfi.no_attempt_rollovers + 1
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND COALESCE(sfi.did_not_attempt, false) = false
    AND sfi.status = 'draft'
    AND sfi.role_context = 'student'
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) < 2
    AND (
      COALESCE(sfi.submission_count, 0) = 0
      OR EXISTS (
        SELECT 1
        FROM public.skyline_form_assessment_summary_data s
        WHERE s.instance_id = sfi.id
          AND (
            (
              s.final_attempt_1_result = 'not_yet_competent'
              AND s.final_attempt_2_result IS NULL
              AND COALESCE(sfi.submission_count, 0) = 1
            )
            OR (
              s.final_attempt_2_result = 'not_yet_competent'
              AND s.final_attempt_3_result IS NULL
              AND COALESCE(sfi.submission_count, 0) = 2
            )
          )
      )
    );

  UPDATE public.skyline_instance_access_tokens t
  SET
    expires_at = (((sfi.end_date + 1)::timestamp - interval '1 millisecond') AT TIME ZONE 'Australia/Melbourne'),
    revoked_at = NULL
  FROM public.skyline_form_instances sfi
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND t.instance_id = sfi.id
    AND t.role_context = 'student'
    AND t.consumed_at IS NULL;

  UPDATE public.skyline_form_instances sfi
  SET
    did_not_attempt = true,
    role_context = 'office'
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND COALESCE(sfi.did_not_attempt, false) = false
    AND sfi.status = 'draft'
    AND sfi.role_context = 'student'
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) >= 2
    AND (
      COALESCE(sfi.submission_count, 0) = 0
      OR EXISTS (
        SELECT 1
        FROM public.skyline_form_assessment_summary_data s
        WHERE s.instance_id = sfi.id
          AND (
            (
              s.final_attempt_1_result = 'not_yet_competent'
              AND s.final_attempt_2_result IS NULL
              AND COALESCE(sfi.submission_count, 0) = 1
            )
            OR (
              s.final_attempt_2_result = 'not_yet_competent'
              AND s.final_attempt_3_result IS NULL
              AND COALESCE(sfi.submission_count, 0) = 2
            )
          )
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
