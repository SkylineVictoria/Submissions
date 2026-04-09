-- Additional Instructions: section-level instructions (not bound to a task row).
-- Stored on skyline_form_sections so it can be rendered in PDF and UI.

ALTER TABLE skyline_form_sections
  ADD COLUMN IF NOT EXISTS instructions_meta JSONB;

