-- Melbourne dates when the trainer submitted NYC per attempt (workflow deadlines).
-- Not the accessibility/summary sheet trainer_date_* fields on assessment summary.

ALTER TABLE public.skyline_form_instances
  ADD COLUMN IF NOT EXISTS trainer_nyc_assessed_on_1 date,
  ADD COLUMN IF NOT EXISTS trainer_nyc_assessed_on_2 date,
  ADD COLUMN IF NOT EXISTS trainer_nyc_assessed_on_3 date;

COMMENT ON COLUMN public.skyline_form_instances.trainer_nyc_assessed_on_1 IS
  'Melbourne date when trainer submitted NYC for attempt 1; student resubmission deadline = this + 5 days.';
COMMENT ON COLUMN public.skyline_form_instances.trainer_nyc_assessed_on_2 IS
  'Melbourne date when trainer submitted NYC for attempt 2; student resubmission deadline = this + 5 days.';
COMMENT ON COLUMN public.skyline_form_instances.trainer_nyc_assessed_on_3 IS
  'Melbourne date when trainer submitted NYC for attempt 3 (terminal if still NYC).';
