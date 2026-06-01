-- Instances reopened to draft must not keep workflow_status failed/completed when the student never submitted.

UPDATE public.skyline_form_instances
SET workflow_status = 'draft'
WHERE status = 'draft'
  AND COALESCE(submission_count, 0) = 0
  AND submitted_at IS NULL
  AND COALESCE(did_not_attempt, false) = false
  AND workflow_status IS DISTINCT FROM 'draft';
