import { describe, expect, it } from 'vitest';
import {
  resolveAssessmentWorkflowState,
  resolveEffectiveSubmissionCount,
  type AttemptResult,
} from './assessmentWorkflowState';
import {
  calculateAssessmentFinalStatus,
  computeAttemptTones,
  getAdminOfficeDotTone,
  getAssessmentOutcomeDisplay,
} from './assessmentRowUi';

const none: AttemptResult[] = [null, null, null];

describe('resolveAssessmentWorkflowState — one rule per attempt', () => {
  it('student submitted, trainer has not started: trainer pending, admin idle', () => {
    const s = resolveAssessmentWorkflowState({
      status: 'submitted',
      role_context: 'trainer',
      workflow_status: 'waiting_trainer',
      submission_count: 1,
      attempt_results: none,
    });
    expect(s.currentAttempt).toBe(1);
    expect(s.studentStage).toBe('done');
    expect(s.trainerStage).toBe('pending');
    expect(s.adminStage).toBe('idle');
    expect(s.adminQueueEligible).toBe(false);
  });

  it('partial trainer save (some marks, no outcome) never activates the admin stage', () => {
    // Trainer saved marks mid-review; nothing written to the instance row, summary outcome still null.
    const row = {
      status: 'submitted',
      role_context: 'trainer',
      workflow_status: 'waiting_trainer',
      submission_count: 1,
      submitted_at: '2026-09-05T03:12:04Z',
      attempt_results: none,
    };
    const s = resolveAssessmentWorkflowState(row);
    expect(s.trainerReviewComplete).toBe(false);
    expect(s.trainerStage).toBe('pending');
    expect(s.adminStage).toBe('idle');

    const final = calculateAssessmentFinalStatus(row);
    expect(final.status).toBe('pending_review');
    expect(final.trainerProgress).toBe('pending');
    expect(final.officeProgress).toBe('idle');
    expect(getAdminOfficeDotTone({ ...row, attemptResults: none })).toBe('gray');
    expect(computeAttemptTones({ submissionCount: 1, results: none, role_context: 'trainer', status: 'submitted' })).toEqual({
      student: ['yellow', 'gray', 'gray'],
      trainer: ['yellow', 'gray', 'gray'],
    });
  });

  it('row pushed to office without a trainer outcome (bug 1 shape) is NOT admin pending and NOT queue eligible', () => {
    // Production instance 8981: role_context office / waiting_office, summary outcome null.
    const row = {
      status: 'submitted',
      role_context: 'office',
      workflow_status: 'waiting_office',
      submission_count: 1,
      submitted_at: '2026-09-05T03:12:04Z',
      did_not_attempt: false,
      attempt_results: none,
    };
    const s = resolveAssessmentWorkflowState(row);
    expect(s.trainerReviewComplete).toBe(false);
    expect(s.adminStage).toBe('idle');
    expect(s.adminQueueEligible).toBe(false);
    expect(getAdminOfficeDotTone({ ...row, attemptResults: none })).toBe('gray');
    const final = calculateAssessmentFinalStatus(row);
    expect(final.officeProgress).toBe('idle');
  });

  it('trainer completed with outcome but not yet submitted: trainer Checked, admin idle', () => {
    const row = {
      status: 'submitted',
      role_context: 'trainer',
      workflow_status: 'waiting_trainer',
      submission_count: 1,
      attempt_results: ['competent', null, null] as AttemptResult[],
    };
    const s = resolveAssessmentWorkflowState(row);
    expect(s.trainerReviewComplete).toBe(true);
    expect(s.trainerStage).toBe('done');
    expect(s.adminStage).toBe('idle');
    const final = calculateAssessmentFinalStatus(row);
    expect(final.status).toBe('trainer_completed');
    expect(final.comment).toBe('Competent');
    expect(final.trainerProgress).toBe('done');
    expect(final.officeProgress).toBe('idle');
    const label = getAssessmentOutcomeDisplay({ ...row, attemptResults: row.attempt_results, submissionCount: 1 });
    expect(label.label).toBe('Competent');
    expect(label.subtext).toBe('Trainer');
    expect(computeAttemptTones({ submissionCount: 1, results: row.attempt_results, role_context: 'trainer', status: 'submitted' })).toEqual({
      student: ['green', 'gray', 'gray'],
      trainer: ['green', 'gray', 'gray'],
    });
  });

  it('trainer final submit (competent → office): trainer Checked, admin pending and in the queue', () => {
    const row = {
      status: 'submitted',
      role_context: 'office',
      workflow_status: 'waiting_office',
      submission_count: 1,
      attempt_results: ['competent', null, null] as AttemptResult[],
    };
    const s = resolveAssessmentWorkflowState(row);
    expect(s.trainerStage).toBe('done');
    expect(s.adminStage).toBe('pending');
    expect(s.adminQueueEligible).toBe(true);
    expect(getAdminOfficeDotTone({ ...row, attemptResults: row.attempt_results })).toBe('yellow');
    const final = calculateAssessmentFinalStatus(row);
    expect(final.officeProgress).toBe('pending');
    const label = getAssessmentOutcomeDisplay({ ...row, attemptResults: row.attempt_results, submissionCount: 1 });
    expect(label.subtext).toBe('Office');
  });

  it('office completed: everything done', () => {
    const s = resolveAssessmentWorkflowState({
      status: 'locked',
      role_context: 'office',
      workflow_status: 'completed',
      submission_count: 1,
      attempt_results: ['competent', null, null],
    });
    expect(s.officeCompleted).toBe(true);
    expect([s.studentStage, s.trainerStage, s.adminStage]).toEqual(['done', 'done', 'done']);
  });

  it('bug 2 shape: inflated submission_count with a competent on attempt 1 — attempt 1 drives the status', () => {
    // Production instance 9017: submission_count 3, no_attempt_rollovers 1, only attempt 1 marked (competent).
    const row = {
      status: 'submitted',
      role_context: 'trainer',
      workflow_status: 'waiting_trainer',
      submission_count: 3,
      no_attempt_rollovers: 1,
      did_not_attempt: false,
      attempt_results: ['competent', null, null] as AttemptResult[],
    };
    const s = resolveAssessmentWorkflowState(row);
    expect(s.currentAttempt).toBe(1);
    expect(s.submittedAttempts).toBe(1);
    expect(s.trainerOutcome).toBe('competent');
    expect(s.trainerStage).toBe('done');
    expect(s.adminStage).toBe('idle');
    expect(resolveEffectiveSubmissionCount(row)).toBe(1);

    const final = calculateAssessmentFinalStatus(row);
    expect(final.comment).toBe('Competent');
    expect(final.trainerProgress).toBe('done');
    expect(final.officeProgress).toBe('idle');
    expect(
      computeAttemptTones({
        submissionCount: 3,
        results: row.attempt_results,
        role_context: 'trainer',
        status: 'submitted',
        no_attempt_rollovers: 1,
        did_not_attempt: false,
      }),
    ).toEqual({ student: ['green', 'gray', 'gray'], trainer: ['green', 'gray', 'gray'] });
  });

  it('multiple attempts: the latest opened attempt drives the status', () => {
    // Attempt 1 NYC, attempt 2 competent, handed to office.
    const row = {
      status: 'submitted',
      role_context: 'office',
      workflow_status: 'waiting_office',
      submission_count: 2,
      attempt_results: ['not_yet_competent', 'competent', null] as AttemptResult[],
    };
    const s = resolveAssessmentWorkflowState(row);
    expect(s.currentAttempt).toBe(2);
    expect(s.trainerOutcome).toBe('competent');
    expect(s.trainerStage).toBe('done');
    expect(s.adminStage).toBe('pending');
    const final = calculateAssessmentFinalStatus(row);
    expect(final.comment).toBe('Competent');
    expect(computeAttemptTones({ submissionCount: 2, results: row.attempt_results, role_context: 'office', status: 'submitted' })).toEqual({
      student: ['red', 'green', 'gray'],
      trainer: ['red', 'green', 'gray'],
    });
  });

  it('re-attempt after a not-satisfactory outcome: student must resubmit, trainer idle, admin idle', () => {
    const returned = {
      status: 'draft',
      role_context: 'student',
      workflow_status: 'draft',
      submission_count: 1,
      attempt_results: ['not_yet_competent', null, null] as AttemptResult[],
    };
    const s = resolveAssessmentWorkflowState(returned);
    expect(s.currentAttempt).toBe(2);
    expect(s.resubmissionRequired).toBe(true);
    expect(s.studentStage).toBe('pending');
    expect(s.trainerStage).toBe('idle');
    expect(s.adminStage).toBe('idle');
    const final = calculateAssessmentFinalStatus(returned);
    expect(final.status).toBe('resubmission_required');
    expect(final.comment).toBe('Not competent');
    expect(final.officeProgress).toBe('idle');
    expect(computeAttemptTones({ submissionCount: 1, results: returned.attempt_results, role_context: 'student', status: 'draft' })).toEqual({
      student: ['red', 'yellow', 'gray'],
      trainer: ['red', 'gray', 'gray'],
    });

    // Student resubmits attempt 2 → trainer reviewing attempt 2, no outcome yet.
    const resubmitted = { ...returned, status: 'submitted', role_context: 'trainer', workflow_status: 'waiting_trainer', submission_count: 2 };
    const s2 = resolveAssessmentWorkflowState(resubmitted);
    expect(s2.currentAttempt).toBe(2);
    expect(s2.trainerStage).toBe('pending');
    expect(s2.adminStage).toBe('idle');
    expect(getAssessmentOutcomeDisplay({ ...resubmitted, attemptResults: resubmitted.attempt_results, submissionCount: 2 })).toMatchObject({
      label: 'In progress',
      subtext: 'Trainer',
    });
    expect(computeAttemptTones({ submissionCount: 2, results: resubmitted.attempt_results, role_context: 'trainer', status: 'submitted' })).toEqual({
      student: ['red', 'yellow', 'gray'],
      trainer: ['red', 'yellow', 'gray'],
    });

    // Trainer marks attempt 2 NYC but has not pressed submit: still attempt 2, trainer done with NYC, admin idle.
    const nycAgain = { ...resubmitted, attempt_results: ['not_yet_competent', 'not_yet_competent', null] as AttemptResult[] };
    const s3 = resolveAssessmentWorkflowState(nycAgain);
    expect(s3.currentAttempt).toBe(2);
    expect(s3.trainerOutcome).toBe('not_yet_competent');
    expect(s3.adminStage).toBe('idle');
  });

  it('third NYC locks the assessment as failed: trainer done, admin idle, no queue', () => {
    const row = {
      status: 'locked',
      role_context: 'office',
      workflow_status: 'failed',
      submission_count: 3,
      attempt_results: ['not_yet_competent', 'not_yet_competent', 'not_yet_competent'] as AttemptResult[],
    };
    const s = resolveAssessmentWorkflowState(row);
    expect(s.currentAttempt).toBe(3);
    expect(s.trainerOutcome).toBe('not_yet_competent');
    expect(s.adminStage).toBe('idle');
    expect(s.adminQueueEligible).toBe(false);
  });

  it('effective submission count caps the trainer marking column by the NYC chain', () => {
    expect(resolveEffectiveSubmissionCount({ submission_count: 3, role_context: 'trainer', status: 'submitted', attempt_results: none })).toBe(1);
    expect(resolveEffectiveSubmissionCount({ submission_count: 2, role_context: 'trainer', status: 'submitted', attempt_results: ['not_yet_competent', null, null] })).toBe(2);
    expect(resolveEffectiveSubmissionCount({ submission_count: 1, role_context: 'trainer', status: 'submitted', attempt_results: ['not_yet_competent', null, null] })).toBe(1);
    expect(resolveEffectiveSubmissionCount({ submission_count: 0, role_context: 'student', status: 'draft', attempt_results: none })).toBe(0);
    expect(resolveEffectiveSubmissionCount({ submission_count: 1, role_context: 'student', status: 'draft', attempt_results: ['not_yet_competent', null, null] })).toBe(1);
  });
});
