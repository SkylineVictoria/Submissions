-- Add explicit workflow status for instance lifecycle:
-- draft -> waiting_trainer -> waiting_office -> completed
ALTER TABLE skyline_form_instances
  ADD COLUMN IF NOT EXISTS workflow_status TEXT DEFAULT 'draft' CHECK (workflow_status IN ('draft', 'waiting_trainer', 'waiting_office', 'completed')),
  ADD COLUMN IF NOT EXISTS trainer_checked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS office_checked_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_skyline_form_instances_workflow_status
  ON skyline_form_instances(workflow_status);
