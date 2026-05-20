-- Internal admin reference note per assessment instance (not shown to students).

ALTER TABLE public.skyline_form_instances
  ADD COLUMN IF NOT EXISTS admin_reference_note TEXT;

COMMENT ON COLUMN public.skyline_form_instances.admin_reference_note IS
  'Admin-only internal note on student assessment; must not be exposed in student-facing APIs.';
