-- Broadcast INSERT/UPDATE on skyline_notifications so Supabase Realtime clients receive postgres_changes.
-- Without this, the bell badge only updates on manual refresh / opening the dropdown.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'skyline_notifications'
  ) THEN
    RETURN;
  END IF;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.skyline_notifications;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
