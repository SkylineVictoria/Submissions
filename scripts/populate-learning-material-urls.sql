-- Populate learning_material_urls on skyline_forms from existing files in storage.objects.
-- Files live at: photomedia / Learning / <slugified-form-name>-<form-id> / <filename>
-- Trainer-only files are in a /trainer/ subfolder and are excluded (student-facing only).
--
-- Public URL pattern (bucket is PUBLIC):
--   https://qoylrmorezlqdvufonmx.supabase.co/storage/v1/object/public/photomedia/<path>

WITH learning_files AS (
  SELECT
    o.name AS file_path,
    -- Extract the folder segment: Learning/<folder>/<file> → <folder>
    split_part(o.name, '/', 2) AS folder_segment,
    -- Extract form ID: last token after the last hyphen in the folder segment
    -- e.g. "cpc30220-cpccca2002-use-carpentry-tools-and-equipment-5" → "5"
    (regexp_match(split_part(o.name, '/', 2), '-(\d+)$'))[1]::bigint AS form_id
  FROM storage.objects o
  WHERE o.bucket_id = 'photomedia'
    AND o.name LIKE 'Learning/%'
    -- Exclude .emptyFolderPlaceholder files
    AND o.name NOT LIKE '%/.emptyFolderPlaceholder'
    -- Only files directly in the form folder (not in /trainer/ subfolder)
    AND array_length(string_to_array(o.name, '/'), 1) = 3
),
url_arrays AS (
  SELECT
    lf.form_id,
    array_agg(
      'https://qoylrmorezlqdvufonmx.supabase.co/storage/v1/object/public/photomedia/' || lf.file_path
      ORDER BY lf.file_path
    ) AS urls
  FROM learning_files lf
  WHERE lf.form_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM skyline_forms sf WHERE sf.id = lf.form_id)
  GROUP BY lf.form_id
)
UPDATE skyline_forms sf
SET learning_material_urls = ua.urls
FROM url_arrays ua
WHERE sf.id = ua.form_id;
