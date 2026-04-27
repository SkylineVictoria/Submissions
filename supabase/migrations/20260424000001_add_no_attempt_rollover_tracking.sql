-- Track missed (no-submission) attempt windows without a cron.
-- We roll over +5 days up to 3 windows (0->1, 1->2), then mark did_not_attempt on final expiry.

ALTER TABLE public.skyline_form_instances
  ADD COLUMN IF NOT EXISTS no_attempt_rollovers integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS did_not_attempt boolean NOT NULL DEFAULT false;

-- Sync / apply rollover server-side so it works under RLS (student dashboard runs as anon).
-- Returns the current state for all provided instance ids.
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
  -- Extend +5 days for eligible rows with 0/1 rollovers.
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

  -- Keep student tokens aligned and active when we extend.
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

  -- Final expiry: mark did-not-attempt & failed.
  UPDATE public.skyline_form_instances sfi
  SET
    did_not_attempt = true,
    role_context = 'office'
  WHERE
    sfi.id = ANY(p_instance_ids)
    AND COALESCE(sfi.did_not_attempt, false) = false
    AND COALESCE(sfi.submission_count, 0) = 0
    AND sfi.status = 'draft'
    AND sfi.role_context = 'student'
    AND sfi.end_date IS NOT NULL
    AND today_mel > sfi.end_date
    AND COALESCE(sfi.no_attempt_rollovers, 0) >= 2;

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

GRANT EXECUTE ON FUNCTION public.skyline_sync_no_attempt_rollover(bigint[]) TO anon, authenticated;

