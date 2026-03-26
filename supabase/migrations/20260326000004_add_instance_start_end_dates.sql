-- Bind start/end dates to assessment instances (per student), not forms.
-- Admin can set and extend these dates to control assessment access/expiry.
ALTER TABLE skyline_form_instances
  ADD COLUMN IF NOT EXISTS start_date TEXT,
  ADD COLUMN IF NOT EXISTS end_date TEXT;

CREATE INDEX IF NOT EXISTS idx_skyline_form_instances_start_date ON skyline_form_instances(start_date);
CREATE INDEX IF NOT EXISTS idx_skyline_form_instances_end_date ON skyline_form_instances(end_date);

