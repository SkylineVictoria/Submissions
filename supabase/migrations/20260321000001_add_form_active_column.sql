-- Add active column to skyline_forms. When false, only admins can access the form.
ALTER TABLE skyline_forms ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;
COMMENT ON COLUMN skyline_forms.active IS 'When false, form is only accessible to users with admin role.';
