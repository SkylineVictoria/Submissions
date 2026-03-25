-- Track number of student submissions (attempt cycles) per instance.
-- 0 = never submitted, 1 = first submission, 2 = second submission, etc.
ALTER TABLE skyline_form_instances
  ADD COLUMN IF NOT EXISTS submission_count INTEGER NOT NULL DEFAULT 0;

-- Backfill: if instance has ever been submitted, count it as the first submission.
UPDATE skyline_form_instances
SET submission_count = 1
WHERE submission_count = 0
  AND submitted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skyline_form_instances_submission_count
  ON skyline_form_instances(submission_count);

