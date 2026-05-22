-- Run this in Supabase Dashboard > SQL Editor if uploads fail (induction Step 4, cover images, etc.)
-- Adds storage policies for photomedia bucket (paths like skyline/induction/...).
-- This fixes STORAGE only. Filenames on the induction form are shown by the frontend app — redeploy the web app after UI fixes.
-- SignFlow uses anon key for public induction; these policies allow upload/read.

-- INSERT: allow uploads to photomedia (anon + authenticated)
DROP POLICY IF EXISTS "photomedia_allow_insert" ON storage.objects;
CREATE POLICY "photomedia_allow_insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'photomedia');

-- UPDATE: needed for upsert (overwriting existing files)
DROP POLICY IF EXISTS "photomedia_allow_update" ON storage.objects;
CREATE POLICY "photomedia_allow_update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'photomedia');

-- SELECT: allow public read
DROP POLICY IF EXISTS "photomedia_allow_select" ON storage.objects;
CREATE POLICY "photomedia_allow_select"
ON storage.objects FOR SELECT
USING (bucket_id = 'photomedia');
