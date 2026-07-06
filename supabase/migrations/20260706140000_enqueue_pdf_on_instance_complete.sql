-- Auto-queue skyline_generated_pdfs when an assessment instance is fully completed.
-- Completed = status 'locked' AND workflow_status 'completed' (office PDF role).
--
-- Also backfills pending rows for instances that were already completed before this migration.
--
-- Optional async worker wake-up via pg_net → trigger-pdf-worker Edge Function.
-- Requires extensions pg_net (+ Vault secrets project_url, service_role_key).
-- Optional Vault secret pdf_worker_cron_secret (matches PDF_WORKER_CRON_SECRET on the Edge Function).
-- If Vault is not configured, queue insert still succeeds; worker can be invoked manually or on schedule.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.skyline_instance_pdf_complete(p_row public.skyline_form_instances)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_row.status, '') = 'locked'
     AND COALESCE(p_row.workflow_status, '') = 'completed';
$$;

COMMENT ON FUNCTION public.skyline_instance_pdf_complete(public.skyline_form_instances) IS
  'True when an instance is locked and workflow completed (eligible for office PDF queue).';

CREATE OR REPLACE FUNCTION public.skyline_enqueue_instance_pdf(
  p_instance_id bigint,
  p_role text DEFAULT 'office'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(NULLIF(btrim(p_role), ''), 'office');
  v_inserted boolean := false;
BEGIN
  IF p_instance_id IS NULL OR p_instance_id <= 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.skyline_generated_pdfs (instance_id, role, pdf_status, last_error)
  VALUES (p_instance_id, v_role, 'pending', NULL)
  ON CONFLICT (instance_id, role) DO NOTHING
  RETURNING true INTO v_inserted;

  RETURN COALESCE(v_inserted, false);
END;
$$;

COMMENT ON FUNCTION public.skyline_enqueue_instance_pdf(bigint, text) IS
  'Insert a pending skyline_generated_pdfs row if none exists for instance_id + role.';

REVOKE ALL ON FUNCTION public.skyline_enqueue_instance_pdf(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_enqueue_instance_pdf(bigint, text) TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.skyline_invoke_pdf_worker_async()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  project_url text;
  service_key text;
  cron_secret text;
  headers jsonb;
  request_id bigint;
BEGIN
  SELECT decrypted_secret INTO project_url
  FROM vault.decrypted_secrets
  WHERE name = 'project_url'
  LIMIT 1;

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF project_url IS NULL OR service_key IS NULL OR btrim(project_url) = '' OR btrim(service_key) = '' THEN
    RETURN NULL;
  END IF;

  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || btrim(service_key)
  );

  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'pdf_worker_cron_secret'
  LIMIT 1;

  IF cron_secret IS NOT NULL AND btrim(cron_secret) <> '' THEN
    headers := headers || jsonb_build_object('x-pdf-worker-cron-secret', btrim(cron_secret));
  END IF;

  SELECT net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/trigger-pdf-worker',
    headers := headers,
    body := jsonb_build_object('limit', 1, 'role', 'office', 'trigger', 'instance_complete'),
    timeout_milliseconds := 30000
  ) INTO request_id;

  RETURN request_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'skyline_invoke_pdf_worker_async skipped: %', SQLERRM;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.skyline_invoke_pdf_worker_async() IS
  'Best-effort async call to trigger-pdf-worker Edge Function via pg_net (optional).';

REVOKE ALL ON FUNCTION public.skyline_invoke_pdf_worker_async() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_invoke_pdf_worker_async() TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.skyline_enqueue_pdf_on_instance_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  was_complete boolean;
  is_complete boolean;
  queued boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    was_complete := false;
    is_complete := public.skyline_instance_pdf_complete(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    was_complete := public.skyline_instance_pdf_complete(OLD);
    is_complete := public.skyline_instance_pdf_complete(NEW);
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF is_complete AND NOT was_complete THEN
    queued := public.skyline_enqueue_instance_pdf(NEW.id, 'office');
    IF queued THEN
      PERFORM public.skyline_invoke_pdf_worker_async();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.skyline_enqueue_pdf_on_instance_complete() IS
  'AFTER INSERT/UPDATE on skyline_form_instances: queue office PDF when instance becomes locked+completed.';

DROP TRIGGER IF EXISTS skyline_enqueue_pdf_on_instance_complete ON public.skyline_form_instances;
CREATE TRIGGER skyline_enqueue_pdf_on_instance_complete
  AFTER INSERT OR UPDATE OF status, workflow_status ON public.skyline_form_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_enqueue_pdf_on_instance_complete();

-- Backfill: queue office PDFs for instances already completed before this migration.
INSERT INTO public.skyline_generated_pdfs (instance_id, role, pdf_status, last_error)
SELECT i.id, 'office', 'pending', NULL
FROM public.skyline_form_instances i
WHERE COALESCE(i.status, '') = 'locked'
  AND COALESCE(i.workflow_status, '') = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM public.skyline_generated_pdfs g
    WHERE g.instance_id = i.id
      AND g.role = 'office'
  );

CREATE OR REPLACE FUNCTION public.skyline_seed_completed_instance_pdfs(
  p_role text DEFAULT 'office',
  p_limit int DEFAULT 500
)
RETURNS TABLE(instance_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := COALESCE(NULLIF(btrim(p_role), ''), 'office');
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 500), 500));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT i.id
    FROM public.skyline_form_instances i
    WHERE COALESCE(i.status, '') = 'locked'
      AND COALESCE(i.workflow_status, '') = 'completed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.skyline_generated_pdfs g
        WHERE g.instance_id = i.id
          AND g.role = v_role
      )
    ORDER BY i.id
    LIMIT v_limit
  ),
  inserted AS (
    INSERT INTO public.skyline_generated_pdfs (instance_id, role, pdf_status, last_error)
    SELECT c.id, v_role, 'pending', NULL
    FROM candidates c
    ON CONFLICT (instance_id, role) DO NOTHING
    RETURNING skyline_generated_pdfs.instance_id
  )
  SELECT inserted.instance_id FROM inserted;
END;
$$;

COMMENT ON FUNCTION public.skyline_seed_completed_instance_pdfs(text, int) IS
  'Queue pending PDF rows for completed locked instances missing a skyline_generated_pdfs row.';

REVOKE ALL ON FUNCTION public.skyline_seed_completed_instance_pdfs(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skyline_seed_completed_instance_pdfs(text, int) TO postgres, service_role;
