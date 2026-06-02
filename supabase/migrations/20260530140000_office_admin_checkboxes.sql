-- Office admin: Initial / Updated checkboxes (replace date+name entry for SMS tracking).

ALTER TABLE public.skyline_form_results_office
  ADD COLUMN IF NOT EXISTS initial_checked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_checked boolean NOT NULL DEFAULT false;

ALTER TABLE public.skyline_form_assessment_summary_data
  ADD COLUMN IF NOT EXISTS admin_initial_checked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_updated_checked boolean NOT NULL DEFAULT false;
