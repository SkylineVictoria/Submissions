-- Rollover backfill for missed 2nd attempt uses system trainer_nyc_assessed_on_1 when set.

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
  r record;
BEGIN
  UPDATE public.skyline_form_instances sfi
  SET
    end_date = sfi.end_date + 5,
    no_attempt_rollovers = sfi.no_attempt_rollovers + 1
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND COALESCE(sfi.did_not_attempt, false) = false
    AND COALESCE(sfi.submission_count, 0) = 0
    AND sfi.status = 'draft'
    AND sfi.role_context = 'student'
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) < 2;

  FOR r IN
    UPDATE public.skyline_form_instances sfi
    SET
      end_date = sfi.end_date + 5,
      no_attempt_rollovers = sfi.no_attempt_rollovers + 1,
      role_context = 'student',
      status = 'draft'
    WHERE
      sfi.id = ANY(p_instance_ids)
      AND COALESCE(sfi.did_not_attempt, false) = false
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
    RETURNING sfi.id AS iid, sfi.end_date AS new_end, sfi.trainer_nyc_assessed_on_1 AS nyc1
  LOOP
    UPDATE public.skyline_form_assessment_summary_data s
    SET final_attempt_2_result = 'not_yet_competent'
    WHERE s.instance_id = r.iid
      AND s.final_attempt_2_result IS NULL;

    UPDATE public.skyline_form_results_data rd
    SET
      second_attempt_satisfactory = 'ns',
      second_attempt_date = COALESCE(
        NULLIF(TRIM(COALESCE(rd.second_attempt_date, '')), ''),
        to_char(COALESCE(r.nyc1, r.new_end - 5), 'YYYY-MM-DD')
      )
    WHERE rd.instance_id = r.iid
      AND rd.second_attempt_satisfactory IS NULL;
  END LOOP;

  UPDATE public.skyline_form_instances sfi
  SET
    end_date = sfi.end_date + 5,
    no_attempt_rollovers = sfi.no_attempt_rollovers + 1,
    role_context = 'student',
    status = 'draft'
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND COALESCE(sfi.did_not_attempt, false) = false
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
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) >= 2
    AND (
      (sfi.role_context = 'student' AND sfi.status = 'draft')
      OR (sfi.role_context = 'trainer' AND sfi.status = 'submitted')
    )
    AND (
      COALESCE(sfi.submission_count, 0) = 0
      OR EXISTS (
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
