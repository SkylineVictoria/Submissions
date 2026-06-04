-- Daily morning aXcelerate finance sync via pg_cron → axcelerate-finance-sync-cron Edge Function.
--
-- Schedule: 19:00 UTC daily ≈ 6:00 AM Australia/Melbourne (AEDT); 5:00 AM AEST.
--
-- Prerequisites (Supabase Dashboard → Database → Extensions): enable pg_cron and pg_net.
--
-- One-time Vault setup (SQL Editor; replace values):
--   SELECT vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
--   SELECT vault.create_secret('YOUR_SERVICE_ROLE_JWT', 'service_role_key');
-- Optional (recommended): match FINANCE_SYNC_CRON_SECRET on the Edge Function:
--   SELECT vault.create_secret('your-long-random-secret', 'finance_sync_cron_secret');
--
-- Deploy Edge Function: axcelerate-finance-sync-cron
-- Set secret FINANCE_SYNC_CRON_SECRET if you created finance_sync_cron_secret in Vault.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_axcelerate_finance_sync_cron()
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
    RAISE WARNING 'axcelerate-finance-sync cron skipped: configure Vault secrets project_url and service_role_key';
    RETURN NULL;
  END IF;

  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || btrim(service_key)
  );

  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'finance_sync_cron_secret'
  LIMIT 1;

  IF cron_secret IS NOT NULL AND btrim(cron_secret) <> '' THEN
    headers := headers || jsonb_build_object('x-finance-sync-cron-secret', btrim(cron_secret));
  END IF;

  SELECT net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/axcelerate-finance-sync-cron',
    headers := headers,
    body := jsonb_build_object('trigger', 'pg_cron', 'scheduled_at', now()),
    timeout_milliseconds := 150000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

COMMENT ON FUNCTION public.invoke_axcelerate_finance_sync_cron() IS
  'Triggers axcelerate-finance-sync-cron (full batched aXcelerate invoice sync). Used by pg_cron.';

REVOKE ALL ON FUNCTION public.invoke_axcelerate_finance_sync_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_axcelerate_finance_sync_cron() TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'axcelerate-finance-sync-daily') THEN
    PERFORM cron.unschedule('axcelerate-finance-sync-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'axcelerate-finance-sync-daily',
  '0 19 * * *',
  $$ SELECT public.invoke_axcelerate_finance_sync_cron(); $$
);
