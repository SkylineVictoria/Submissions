-- Add 'failed' to instance workflow status enum/check.
-- Failed means: after 3 attempts, still Not Yet Competent -> lock the instance and stop resubmissions.

DO $$
BEGIN
  -- Only run if the column exists (older DBs may not have this migration applied yet).
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'skyline_form_instances'
      AND column_name = 'workflow_status'
  ) THEN
    -- Drop the existing check constraint (name can vary) and recreate with 'failed'.
    -- We try common naming patterns; ignore errors if not found.
    BEGIN
      ALTER TABLE public.skyline_form_instances
        DROP CONSTRAINT IF EXISTS skyline_form_instances_workflow_status_check;
    EXCEPTION WHEN others THEN
      -- no-op
    END;

    BEGIN
      ALTER TABLE public.skyline_form_instances
        DROP CONSTRAINT IF EXISTS skyline_form_instances_workflow_status_check1;
    EXCEPTION WHEN others THEN
      -- no-op
    END;

    -- Re-add check constraint allowing 'failed'.
    ALTER TABLE public.skyline_form_instances
      ADD CONSTRAINT skyline_form_instances_workflow_status_check
      CHECK (workflow_status IN ('draft', 'waiting_trainer', 'waiting_office', 'completed', 'failed'));
  END IF;
END $$;

