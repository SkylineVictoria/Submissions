-- Add a column to store external learning material URLs per form.
ALTER TABLE skyline_forms
  ADD COLUMN IF NOT EXISTS learning_material_urls TEXT[] DEFAULT '{}';
