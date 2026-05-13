-- Trainer dashboards key off role_context = 'trainer' for the pending queue (see listDashboardInstances).
-- Rows could show "awaiting trainer" in admin UI from submission_count / submitted_at while role_context
-- stayed 'student' if a follow-up update failed. Align those instances.
--
-- Does not use workflow_status: some deployments never added that column; legacy rows still use
-- status + submitted_at from student submit.

UPDATE skyline_form_instances
SET
  role_context = 'trainer',
  updated_at = now()
WHERE role_context = 'student'
  AND COALESCE(status, '') = 'submitted'
  AND submitted_at IS NOT NULL;
