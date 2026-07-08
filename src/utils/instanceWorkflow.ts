import type { InstanceWorkflowStatus } from '../lib/formEngine';

export type InstanceWorkflowInput = {
  workflow_status?: string | null;
  status?: string | null;
  role_context?: string | null;
  submission_count?: number | null;
  submitted_at?: string | null;
  did_not_attempt?: boolean | null;
};

/** Mirrors InstanceFillPage workflow normalization for completion checks. */
export function normalizeInstanceWorkflowStatus(inst: InstanceWorkflowInput): InstanceWorkflowStatus {
  const rawWorkflow = String(inst.workflow_status ?? '').trim();
  const legacyStatus = String(inst.status ?? 'draft').trim() || 'draft';
  const roleCtx = String(inst.role_context ?? '').trim();
  const instSubmissionCount = Number(inst.submission_count ?? 0) || 0;
  const studentHasSubmitted =
    instSubmissionCount > 0 || Boolean(String(inst.submitted_at ?? '').trim());
  const instDidNotAttempt = Boolean(inst.did_not_attempt);

  let normalizedWorkflow = (
    rawWorkflow
      ? rawWorkflow
      : legacyStatus === 'locked'
        ? 'completed'
        : legacyStatus === 'submitted'
          ? roleCtx === 'office'
            ? 'waiting_office'
            : 'waiting_trainer'
          : legacyStatus === 'draft' && roleCtx === 'trainer'
            ? 'waiting_trainer'
            : legacyStatus === 'draft' && roleCtx === 'office'
              ? 'waiting_office'
              : 'draft'
  ) as InstanceWorkflowStatus;

  if (studentHasSubmitted && !instDidNotAttempt && normalizedWorkflow === 'draft' && roleCtx !== 'student') {
    normalizedWorkflow = roleCtx === 'office' ? 'waiting_office' : 'waiting_trainer';
  }
  if (roleCtx === 'student' && legacyStatus === 'draft' && !studentHasSubmitted && !instDidNotAttempt) {
    if (normalizedWorkflow === 'failed' || normalizedWorkflow === 'completed') {
      normalizedWorkflow = 'draft';
    }
  }
  if (instDidNotAttempt && !studentHasSubmitted) {
    normalizedWorkflow = 'failed';
  }

  // Office queue: submitted + office role is waiting for office check (role_context matches UI badge).
  if (
    roleCtx === 'office' &&
    legacyStatus === 'submitted' &&
    normalizedWorkflow !== 'completed' &&
    normalizedWorkflow !== 'failed'
  ) {
    normalizedWorkflow = 'waiting_office';
  }

  return normalizedWorkflow;
}
