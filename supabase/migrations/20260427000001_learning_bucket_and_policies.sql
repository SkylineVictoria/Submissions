-- Learning materials are stored inside the existing `photomedia` bucket.
-- Path: photomedia/Learning/<formname-id>/<filename>
--
-- Ensure `photomedia` bucket has policies that allow:
-- - anon/authenticated: SELECT
-- - authenticated: INSERT/UPDATE/DELETE
--
-- This project already uses `photomedia/skyline/...` for images. Reuse that bucket
-- to avoid creating new buckets and to match existing storage setup.

