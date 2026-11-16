import { formatIsoDateOnly, formatMelbourneDateTime, isTimestampIso, MELBOURNE_TZ } from './melbourneTime';

import { getEffectiveEndDate } from './assessmentDeadline';
import {
  normalizeAttemptResults,
  resolveAssessmentWorkflowState,
  type AssessmentWorkflowState,
  type AttemptResult,
  type WorkflowStageState,
} from './assessmentWorkflowState';

export type { AttemptResult, WorkflowStageState } from './assessmentWorkflowState';
export { resolveAssessmentWorkflowState } from './assessmentWorkflowState';

export type AttemptDotTone = 'green' | 'red' | 'yellow' | 'gray';

export type AssessmentRowUiState =
  | { kind: 'future'; disabled: true; reason: string; rowClassName: string; outcomeLabel?: never; outcomeClassName?: never }
  | { kind: 'in_progress'; disabled: false; rowClassName: string; outcomeLabel?: never; outcomeClassName?: never }
  | { kind: 'past_competent'; disabled: false; rowClassName: string; outcomeLabel: string; outcomeClassName: string }
  | { kind: 'past_not_competent'; disabled: boolean; rowClassName: string; outcomeLabel: string; outcomeClassName: string }
  | { kind: 'did_not_attempt'; disabled: true; reason: string; rowClassName: string; outcomeLabel: string; outcomeClassName: string }
  | { kind: 'not_submitted'; disabled: true; reason: string; rowClassName: string; outcomeLabel: string; outcomeClassName: string }
  | { kind: 'expired'; disabled: true; reason: string; rowClassName: string; outcomeLabel?: never; outcomeClassName?: never }
  | { kind: 'unknown'; disabled: false; rowClassName: string; outcomeLabel?: never; outcomeClassName?: never };

export type RowWindowInput = {
  start_date?: string | null;
  end_date?: string | null;
  /** Optional later deadline; the deadline is COALESCE(extension_date, end_date). */
  extension_date?: string | null;
  did_not_attempt?: boolean | null;
  no_attempt_rollovers?: number | null;
  status?: string | null;
  role_context?: string | null;
  answer_count?: number | null;
  trainer_assessment_exists?: boolean | null;
  workflow_status?: string | null;
  office_assessment_completed?: boolean | null;
  office_status?: string | null;
  expired?: boolean | null;
};

/** All three submission windows missed — terminal failure (no competent path). */
export function isDidNotAttemptAnyFailure(input: {
  didNotAttempt?: boolean | null;
  noAttemptRollovers?: number | null;
  submissionCount?: number | null;
  submittedAt?: string | null;
}): boolean {
  const rollovers = Math.max(0, Number(input.noAttemptRollovers ?? 0) || 0);
  const submitted = Math.max(
    0,
    Number(input.submissionCount ?? 0) || (String(input.submittedAt ?? '').trim() ? 1 : 0),
  );
  return Boolean(input.didNotAttempt ?? false) && rollovers >= 2 && submitted === 0;
}

/** Strong red row when the student exhausted all attempts without a successful submission path. */
export const TERMINAL_DID_NOT_ATTEMPT_ROW_CLASS =
  'bg-red-100 text-red-950 border-l-4 border-red-600 opacity-95 cursor-not-allowed';

export const NOT_SUBMITTED_ROW_CLASS =
  'bg-orange-50 text-orange-950 border-l-4 border-orange-500 opacity-95 cursor-not-allowed';

export const ALL_ATTEMPTS_FAILED_TONES: AttemptDotTone[] = ['red', 'red', 'red'];

export function melDateString(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: MELBOURNE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d);
}

export function formatDDMMYYYY(value: string | null): string {
  const v = (value ?? '').trim();
  if (!v) return '—';
  if (isTimestampIso(v)) return formatMelbourneDateTime(v);
  return formatIsoDateOnly(v);
}

export type InstanceAccessRole = 'student' | 'trainer' | 'office';

export type InstanceWorkflowRow = {
  status?: string | null;
  role_context?: string | null;
  did_not_attempt?: boolean | null;
  no_attempt_rollovers?: number | null;
  submission_count?: number | null;
  submitted_at?: string | null;
  answer_count?: number | null;
  attempt_results?: AttemptResult[] | null;
  trainer_assessment_exists?: boolean | null;
  end_date?: string | null;
  extension_date?: string | null;
  workflow_status?: string | null;
  office_assessment_completed?: boolean | null;
  /** Compatibility inputs used by API/UI mappers. */
  office_status?: string | null;
  expired?: boolean | null;
};

export type AssessmentFinalStatus =
  | 'completed'
  | 'trainer_completed'
  | 'resubmission_required'
  | 'pending_review'
  | 'not_submitted'
  | 'did_not_attempt'
  | 'in_progress';

export type AssessmentProgressResolution = {
  status: AssessmentFinalStatus;
  comment: string;
  rowTone: 'green' | 'amber' | 'orange' | 'red';
  studentProgress: WorkflowStageState;
  trainerProgress: WorkflowStageState;
  officeProgress: WorkflowStageState;
  terminalDidNotAttempt: boolean;
  suppressExpiry: boolean;
  /** Outcome of the current attempt, falling back to the last recorded outcome. */
  trainerResult: Exclude<AttemptResult, null> | null;
  /** Full per-attempt resolution (single source of truth for icons, dots, labels and queues). */
  workflow: AssessmentWorkflowState;
};

/**
 * Final administrative state always outranks historical submission and rollover data.
 * Stage icons come straight from `resolveAssessmentWorkflowState`:
 *  - Trainer is "done" once an outcome is recorded for the current attempt (or the trainer handed off).
 *  - Admin is "pending" only after the trainer's final submit moved the row to office with that outcome.
 */
export function calculateAssessmentFinalStatus(input: InstanceWorkflowRow): AssessmentProgressResolution {
  const workflow = resolveAssessmentWorkflowState(input);
  const trainerResult = workflow.trainerOutcome ?? workflow.lastRecordedOutcome;
  const legacyStatus = String(input.status ?? '').trim();
  const hasSavedAnswers =
    Math.max(0, Number(input.answer_count ?? 0) || 0) > 0 || legacyStatus === 'incomplete';
  const end = getEffectiveEndDate(input);
  const expired =
    Boolean(input.expired) ||
    (end ? melDateString() > end : legacyStatus === 'incomplete');
  const base = {
    studentProgress: workflow.studentStage,
    trainerProgress: workflow.trainerStage,
    officeProgress: workflow.adminStage,
    terminalDidNotAttempt: false,
    trainerResult,
    workflow,
  };

  if (workflow.officeCompleted) {
    return {
      ...base,
      status: 'completed',
      comment: 'Completed',
      rowTone: 'green',
      studentProgress: 'done',
      trainerProgress: 'done',
      officeProgress: 'done',
      suppressExpiry: true,
    };
  }
  if (workflow.trainerReviewComplete) {
    const competent = workflow.trainerOutcome === 'competent';
    return {
      ...base,
      status: 'trainer_completed',
      comment: competent ? 'Competent' : 'Not competent',
      rowTone: competent ? 'amber' : 'red',
      suppressExpiry: true,
    };
  }
  if (workflow.resubmissionRequired) {
    return {
      ...base,
      status: 'resubmission_required',
      comment: 'Not competent',
      rowTone: 'red',
      suppressExpiry: true,
    };
  }
  if (workflow.studentSubmittedCurrent) {
    return {
      ...base,
      status: 'pending_review',
      comment: 'Submitted',
      rowTone: 'amber',
      studentProgress: 'done',
      trainerProgress: workflow.trainerHandedOff ? 'done' : 'pending',
      suppressExpiry: true,
    };
  }
  if (hasSavedAnswers) {
    return {
      ...base,
      status: expired ? 'not_submitted' : 'in_progress',
      comment: expired ? 'Not submitted by due date' : 'In progress',
      rowTone: expired ? 'orange' : 'amber',
      suppressExpiry: false,
    };
  }
  const terminalDidNotAttempt = isDidNotAttemptAnyFailure({
    didNotAttempt: input.did_not_attempt,
    noAttemptRollovers: input.no_attempt_rollovers,
    submissionCount: input.submission_count,
    submittedAt: input.submitted_at,
  });
  if (terminalDidNotAttempt) {
    return {
      ...base,
      status: 'did_not_attempt',
      comment: "Didn't attempt any",
      rowTone: 'red',
      studentProgress: 'idle',
      trainerProgress: 'idle',
      officeProgress: 'idle',
      terminalDidNotAttempt: true,
      suppressExpiry: false,
    };
  }
  return {
    ...base,
    status: expired ? 'not_submitted' : 'in_progress',
    comment: expired ? 'Not submitted by due date' : 'In progress',
    rowTone: expired ? 'orange' : 'amber',
    suppressExpiry: false,
  };
}

export type AssessmentDisplayStatus =
  | 'competent'
  | 'not_competent'
  | 'submitted'
  | 'saved_answers'
  | 'did_not_attempt'
  | 'in_progress';

export type CalculatedAssessmentDisplayStatus = {
  status: AssessmentDisplayStatus;
  label: string;
  trainerResult: Exclude<AttemptResult, null> | null;
  trainerAssessmentExists: boolean;
  submitted: boolean;
  hasSavedAnswers: boolean;
  terminalDidNotAttempt: boolean;
};

/**
 * Canonical assessment status precedence used by dashboard UIs.
 * A stale rollover flag must never override stronger evidence of activity.
 */
export function calculateAssessmentDisplayStatus(input: InstanceWorkflowRow): CalculatedAssessmentDisplayStatus {
  const final = calculateAssessmentFinalStatus(input);
  const trainerResult = final.trainerResult;
  const trainerAssessmentExists = Boolean(input.trainer_assessment_exists) || trainerResult !== null;
  const submitted =
    getSubmittedAttemptCount({
      submissionCount: input.submission_count,
      submittedAt: input.submitted_at,
    }) > 0;
  const hasSavedAnswers =
    Math.max(0, Number(input.answer_count ?? 0) || 0) > 0 ||
    String(input.status ?? '').trim() === 'incomplete';

  if (final.status === 'completed') {
    return { status: 'competent', label: 'Completed', trainerResult, trainerAssessmentExists, submitted, hasSavedAnswers, terminalDidNotAttempt: false };
  }
  if (final.status === 'trainer_completed' || final.status === 'resubmission_required') {
    return {
      status: final.status === 'trainer_completed' && trainerResult === 'competent' ? 'competent' : 'not_competent',
      label: final.comment,
      trainerResult,
      trainerAssessmentExists,
      submitted,
      hasSavedAnswers,
      terminalDidNotAttempt: false,
    };
  }
  if (final.status === 'pending_review') {
    return { status: 'submitted', label: 'Submitted', trainerResult, trainerAssessmentExists, submitted, hasSavedAnswers, terminalDidNotAttempt: false };
  }
  if (final.status === 'not_submitted' && hasSavedAnswers) {
    return {
      status: 'saved_answers',
      label: final.comment,
      trainerResult,
      trainerAssessmentExists,
      submitted,
      hasSavedAnswers,
      terminalDidNotAttempt: false,
    };
  }
  if (final.terminalDidNotAttempt) {
    return { status: 'did_not_attempt', label: "Didn't attempt any", trainerResult, trainerAssessmentExists, submitted, hasSavedAnswers, terminalDidNotAttempt: true };
  }
  return { status: 'in_progress', label: final.comment, trainerResult, trainerAssessmentExists, submitted, hasSavedAnswers, terminalDidNotAttempt: false };
}

export function isNotSubmittedByDueDate(
  row: Pick<InstanceWorkflowRow, 'status' | 'submission_count' | 'submitted_at'>,
): boolean {
  return (
    String(row.status ?? '').trim() === 'incomplete' &&
    getSubmittedAttemptCount({
      submissionCount: row.submission_count,
      submittedAt: row.submitted_at,
    }) === 0
  );
}

function getSubmittedAttemptCount(input: {
  submissionCount?: number | null;
  submittedAt?: string | null;
}): number {
  return Math.min(
    3,
    Math.max(0, Number(input.submissionCount ?? 0) || (String(input.submittedAt ?? '').trim() ? 1 : 0)),
  );
}

/** Student submitted but instance never moved to trainer queue (stuck draft + student role). */
export function hasStudentSubmissionNotSentToTrainer(row: InstanceWorkflowRow): boolean {
  const submitted = getSubmittedAttemptCount({
    submissionCount: row.submission_count,
    submittedAt: row.submitted_at,
  });
  if (submitted <= 0) return false;
  const rc = String(row.role_context ?? '').trim();
  const st = String(row.status ?? '').trim();
  return rc === 'student' && st === 'draft';
}

export function isAwaitingTrainerReview(row: Pick<InstanceWorkflowRow, 'role_context' | 'status'>): boolean {
  const rc = String(row.role_context ?? '').trim();
  const st = String(row.status ?? '').trim();
  return rc === 'trainer' && st !== 'locked';
}

/** Workflow badge label; terminal missed-all-windows only — not partial rollovers. */
export function getInstanceWorkflowLabel(
  row: InstanceWorkflowRow,
  opts?: { submittedFallback?: string },
): string {
  const display = calculateAssessmentDisplayStatus(row);
  if (display.status === 'competent' || display.status === 'not_competent' || display.status === 'saved_answers') {
    return display.label;
  }
  if (display.terminalDidNotAttempt) return 'Did not attempt';
  const status = String(row.status ?? '').trim();
  const rc = String(row.role_context ?? '').trim();
  if (status === 'locked') return 'Completed';
  if (hasStudentSubmissionNotSentToTrainer(row)) {
    return opts?.submittedFallback ?? 'Submitted (Not Sent)';
  }
  if (rc === 'trainer') return 'Waiting Trainer';
  if (rc === 'office') return 'Waiting Office';
  if (status === 'draft') return 'Awaiting Student';
  return opts?.submittedFallback ?? 'Submitted';
}

export function getInstanceWorkflowBadgeClass(
  row: InstanceWorkflowRow,
  opts?: { withBorder?: boolean },
): string {
  const border = opts?.withBorder ? 'border border-gray-200/80 ' : '';
  const display = calculateAssessmentDisplayStatus(row);
  if (display.status === 'competent') {
    return `${border}bg-emerald-50 text-emerald-800`.trim();
  }
  if (display.status === 'not_competent') {
    return `${border}bg-red-50 text-red-800`.trim();
  }
  if (display.status === 'saved_answers') {
    return `${border}bg-orange-50 text-orange-900`.trim();
  }
  if (display.terminalDidNotAttempt) {
    return `${border}bg-red-50 text-red-800`.trim();
  }
  const status = String(row.status ?? '').trim();
  const rc = String(row.role_context ?? '').trim();
  if (status === 'locked') {
    return `${border}${opts?.withBorder ? 'bg-emerald-50 text-emerald-800' : 'bg-emerald-100 text-emerald-800'}`.trim();
  }
  if (hasStudentSubmissionNotSentToTrainer(row)) {
    return `${border}${opts?.withBorder ? 'bg-orange-50 text-orange-900' : 'bg-orange-100 text-orange-900'}`.trim();
  }
  if (rc === 'trainer') {
    return `${border}${opts?.withBorder ? 'bg-amber-50 text-amber-800' : 'bg-amber-100 text-amber-800'}`.trim();
  }
  if (rc === 'office') {
    return `${border}${opts?.withBorder ? 'bg-sky-50 text-sky-800' : 'bg-blue-100 text-blue-800'}`.trim();
  }
  if (status === 'draft') {
    return `${border}${opts?.withBorder ? 'bg-gray-50 text-gray-700' : 'bg-slate-100 text-slate-700'}`.trim();
  }
  return `${border}${opts?.withBorder ? 'bg-gray-50 text-gray-600' : 'bg-gray-100 text-gray-700'}`.trim();
}

/** Instance start/end window. End date applies to students only; trainers/office may grade after it. */
export function withinInstanceAccessWindow(
  row: RowWindowInput,
  accessRole: InstanceAccessRole = 'student',
  today?: string
): { ok: boolean; reason?: string } {
  const todayMel = (today ?? melDateString()).trim();
  const start = String(row.start_date ?? '').trim();
  const end = getEffectiveEndDate(row);
  if (start && todayMel < start) {
    return { ok: false, reason: `Available from ${formatDDMMYYYY(start)}` };
  }
  if (accessRole === 'student' && end && todayMel > end) {
    return { ok: false, reason: `Expired on ${formatDDMMYYYY(end)} (23:59 AEDT)` };
  }
  return { ok: true };
}

export function computeRowUi(input: {
  row: RowWindowInput;
  today?: string;
  attemptResults?: AttemptResult[]; // attempt1..3
  /** When true, passing end_date does not block access (trainer/office grading after student window). */
  ignoreEndDateForAccess?: boolean;
  submissionCount?: number | null;
  submittedAt?: string | null;
}): AssessmentRowUiState {
  const today = (input.today ?? melDateString()).trim();
  const start = String(input.row.start_date ?? '').trim();
  const end = getEffectiveEndDate(input.row);
  const r = normalizeAttemptResults(input.attemptResults);
  const submitted = getSubmittedAttemptCount({
    submissionCount: input.submissionCount,
    submittedAt: input.submittedAt,
  });
  const finalStatus = calculateAssessmentFinalStatus({
    ...input.row,
    submission_count: submitted,
    submitted_at: input.submittedAt,
    attempt_results: r,
    answer_count: input.row.answer_count,
    trainer_assessment_exists: input.row.trainer_assessment_exists,
  });
  const workflow = finalStatus.workflow;
  // Current-attempt outcome drives the row; a competent recorded on an earlier attempt that was
  // later reopened (admin resubmission) must not paint the row green.
  const anyCompetent = workflow.officeCompleted || workflow.trainerOutcome === 'competent';
  const anyNYC =
    workflow.trainerOutcome === 'not_yet_competent' || finalStatus.status === 'resubmission_required';
  const missedAllWindows = finalStatus.terminalDidNotAttempt;
  // Prior NYC exists and the resubmission is with the trainer (no outcome yet for the current attempt).
  const trainerReviewing =
    workflow.handoffStage === 'trainer' && workflow.studentSubmittedCurrent && workflow.trainerOutcome === null;

  if (finalStatus.status === 'completed') {
    return {
      kind: 'past_competent',
      disabled: false,
      rowClassName:
        'bg-emerald-50/70 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors',
      outcomeLabel: 'Completed',
      outcomeClassName: 'text-emerald-800',
    };
  }

  if (finalStatus.status === 'pending_review') {
    return {
      kind: 'in_progress',
      disabled: false,
      rowClassName:
        'bg-amber-50/70 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors',
    };
  }

  if (finalStatus.status === 'not_submitted' && finalStatus.rowTone === 'orange') {
    return {
      kind: 'not_submitted',
      disabled: true,
      reason: finalStatus.comment,
      rowClassName: NOT_SUBMITTED_ROW_CLASS,
      outcomeLabel: finalStatus.comment,
      outcomeClassName: 'text-orange-900 font-semibold',
    };
  }

  if (String(input.row.status ?? '').trim() === 'incomplete' && submitted === 0) {
    return {
      kind: 'not_submitted',
      disabled: true,
      reason: 'Not submitted by due date',
      rowClassName: NOT_SUBMITTED_ROW_CLASS,
      outcomeLabel: 'Not submitted by due date',
      outcomeClassName: 'text-orange-900 font-semibold',
    };
  }

  // A recorded competent result proves that a trainer assessed the work.
  // Prefer it over stale legacy did_not_attempt flags.
  if (anyCompetent) {
    const isLocked = String(input.row.status ?? '').trim() === 'locked';
    const awaitingOffice = !isLocked;
    return {
      kind: 'past_competent',
      disabled: false,
      rowClassName: awaitingOffice
        ? 'bg-amber-50/70 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors'
        : 'bg-emerald-50/70 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors',
      outcomeLabel: isLocked ? 'Completed' : 'Competent',
      outcomeClassName: isLocked ? 'text-emerald-800' : 'text-emerald-800',
    };
  }

  // Terminal missed-all-windows overrides NYC/auto-sync where no competent
  // trainer result exists — the student failed and all attempts are gone.
  if (missedAllWindows) {
    return {
      kind: 'did_not_attempt',
      disabled: true,
      reason: "Didn't attempt any",
      rowClassName: TERMINAL_DID_NOT_ATTEMPT_ROW_CLASS,
      outcomeLabel: "Didn't attempt any",
      outcomeClassName: 'text-red-800 font-semibold',
    };
  }

  // Prior NYC exists but trainer is still marking a resubmission — stay in progress, not terminal red.
  if (trainerReviewing && r.some((x) => x === 'not_yet_competent')) {
    return {
      kind: 'in_progress',
      disabled: false,
      rowClassName:
        'bg-amber-50/70 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors',
    };
  }

  if (anyNYC) {
    if (end && today > end && !input.ignoreEndDateForAccess) {
      return {
        kind: 'past_not_competent',
        disabled: true,
        rowClassName: 'bg-red-50/70 text-red-900/90 opacity-90 cursor-not-allowed',
        outcomeLabel: 'Competency Not Achieved',
        outcomeClassName: 'text-red-800',
      };
    }
    return {
      kind: 'past_not_competent',
      disabled: false,
      rowClassName: 'bg-red-50/70 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors',
      outcomeLabel: 'Competency Not Achieved',
      outcomeClassName: 'text-red-800',
    };
  }

  if (start && today < start) {
    return {
      kind: 'future',
      disabled: true,
      reason: `Available from ${formatDDMMYYYY(start)}`,
      rowClassName:
        'bg-gray-50 text-gray-500 opacity-70 cursor-not-allowed',
    };
  }
  if (end && today > end && !input.ignoreEndDateForAccess) {
    return {
      kind: 'expired',
      disabled: true,
      reason: `Expired on ${formatDDMMYYYY(end)} (23:59 AEDT)`,
      rowClassName:
        'bg-red-50/70 text-red-900/90 opacity-90 cursor-not-allowed',
    };
  }

  if ((start && today >= start) || !start) {
    return {
      kind: 'in_progress',
      disabled: false,
      rowClassName:
        'bg-amber-50/70 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors',
    };
  }

  return { kind: 'unknown', disabled: false, rowClassName: 'hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors' };
}

export function getAttemptDoneText(attemptResults?: AttemptResult[] | null): string | null {
  const r = (attemptResults ?? []).slice(0, 3);
  if (r[2]) return 'Third Attempt Done';
  if (r[1]) return 'Second Attempt Done';
  if (r[0]) return 'First Attempt Done';
  return null;
}

export function computeWorkflowStageChecks(input: {
  status?: string | null;
  role_context?: string | null;
  workflow_status?: string | null;
  submission_count?: number | null;
  submitted_at?: string | null;
  did_not_attempt?: boolean | null;
  attemptResults: AttemptResult[];
}): { studentDone: boolean; trainerDone: boolean; adminState: WorkflowStageState } {
  const state = resolveAssessmentWorkflowState({
    status: input.status,
    role_context: input.role_context,
    workflow_status: input.workflow_status,
    submission_count: input.submission_count,
    submitted_at: input.submitted_at,
    did_not_attempt: input.did_not_attempt,
    attempt_results: input.attemptResults,
  });
  const isLocked = String(input.status ?? '').trim() === 'locked';
  return {
    studentDone: state.studentStage === 'done',
    trainerDone: state.trainerStage === 'done',
    adminState: state.officeCompleted || isLocked ? 'done' : state.adminStage,
  };
}

/** Primary outcome label + optional subtext (e.g. Office) for dashboard rows. */
export function getAssessmentOutcomeDisplay(input: {
  status?: string | null;
  role_context?: string | null;
  attemptResults?: AttemptResult[] | null;
  submissionCount?: number | null;
  submittedAt?: string | null;
}): { label: string; className: string; subtext: string | null; subtextClassName: string } {
  const state = resolveAssessmentWorkflowState({
    status: input.status,
    role_context: input.role_context,
    submission_count: input.submissionCount,
    submitted_at: input.submittedAt,
    attempt_results: input.attemptResults,
  });
  const isLocked = String(input.status ?? '').trim() === 'locked';
  const st = String(input.status ?? '').trim();
  const submitted = state.rawSubmittedAttempts;
  const stageSubtext = 'text-[11px] font-medium text-amber-700';

  if (st === 'incomplete' && submitted === 0) {
    return {
      label: 'Not submitted by due date',
      className: 'text-orange-900',
      subtext: null,
      subtextClassName: '',
    };
  }

  if (state.trainerOutcome === 'competent') {
    if (isLocked) {
      return {
        label: 'Completed',
        className: 'text-emerald-700',
        subtext: null,
        subtextClassName: '',
      };
    }
    // Trainer checked: with office once the trainer's final submit handed it off, otherwise still on the trainer.
    return {
      label: 'Competent',
      className: 'text-emerald-700',
      subtext: state.handoffStage === 'office' ? 'Office' : 'Trainer',
      subtextClassName: stageSubtext,
    };
  }
  if (state.trainerOutcome === 'not_yet_competent' || state.resubmissionRequired) {
    return {
      label: 'Not competent',
      className: 'text-red-700',
      subtext: null,
      subtextClassName: '',
    };
  }
  if (state.handoffStage === 'trainer' && state.studentSubmittedCurrent && state.currentAttempt > 1) {
    // Resubmission after a prior NYC is with the trainer and not yet marked.
    return {
      label: 'In progress',
      className: 'text-amber-800',
      subtext: 'Trainer',
      subtextClassName: stageSubtext,
    };
  }
  const rcLegacy = String(input.role_context ?? '').trim();
  if (rcLegacy === 'office') {
    return {
      label: 'In progress',
      className: 'text-gray-700',
      subtext: 'Office',
      subtextClassName: 'text-[11px] font-medium text-amber-700',
    };
  }
  if (
    hasStudentSubmissionNotSentToTrainer({
      status: input.status,
      role_context: input.role_context,
      submission_count: input.submissionCount,
      submitted_at: input.submittedAt,
    })
  ) {
    return {
      label: 'Submitted',
      className: 'text-orange-800',
      subtext: 'Not sent to trainer',
      subtextClassName: 'text-[11px] font-medium text-orange-700',
    };
  }
  return { label: 'In progress', className: 'text-gray-700', subtext: null, subtextClassName: '' };
}

export function getTrainerWorkflowStageState(input: {
  terminalFailed?: boolean;
  trainerDone: boolean;
  role_context?: string | null;
  status?: string | null;
  submissionCount?: number;
}): WorkflowStageState {
  if (input.terminalFailed) return 'idle';
  if (input.trainerDone) return 'done';
  if (isAwaitingTrainerReview({ role_context: input.role_context, status: input.status })) {
    const submitted = Math.max(0, Number(input.submissionCount ?? 0) || 0);
    if (submitted > 0) return 'pending';
  }
  return 'idle';
}

function formatAwaitingTrainerText(attemptNum: number): string {
  if (attemptNum >= 3) return 'Submitted 3rd attempt — awaiting trainer';
  if (attemptNum >= 2) return 'Submitted 2nd attempt — awaiting trainer';
  return 'Submitted 1st attempt — awaiting trainer';
}

/** Attempt currently with the trainer: the latest hand-in the NYC chain has opened. */
export function getAwaitingTrainerAttemptNumber(input: {
  submissionCount?: number | null;
  submittedAt?: string | null;
  attemptResults?: AttemptResult[] | null;
  no_attempt_rollovers?: number | null;
  did_not_attempt?: boolean | null;
  role_context?: string | null;
  status?: string | null;
}): number | null {
  const state = resolveAssessmentWorkflowState({
    status: input.status,
    role_context: input.role_context ?? 'trainer',
    submission_count: input.submissionCount,
    submitted_at: input.submittedAt,
    attempt_results: input.attemptResults,
  });
  if (state.rawSubmittedAttempts <= 0) return null;
  return state.currentAttempt;
}

export function getStudentAttemptDoneText(input: {
  submissionCount?: number | null;
  submittedAt?: string | null;
  attemptResults?: AttemptResult[] | null;
  status?: string | null;
  role_context?: string | null;
  no_attempt_rollovers?: number | null;
  did_not_attempt?: boolean | null;
}): string | null {
  const status = String(input.status ?? '').trim();
  const rc = String(input.role_context ?? '').trim();
  const r = (input.attemptResults ?? []).slice(0, 3);

  if (status === 'locked') return null;

  // Competent but not office-locked — primary/subtext handled by getAssessmentOutcomeDisplay.
  if (r.some((x) => x === 'competent')) return null;

  if (rc === 'office') return null;

  // Student resubmitting after NYC — use getTrainerAttemptFailedText ("Second Attempt Required", etc.).
  if (rc === 'student' && status === 'draft') return null;

  if (rc === 'trainer') {
    const awaiting = getAwaitingTrainerAttemptNumber(input);
    return awaiting != null ? formatAwaitingTrainerText(awaiting) : null;
  }

  return getAttemptDoneText(input.attemptResults);
}

export function getTrainerAttemptFailedText(
  attemptResults?: AttemptResult[] | null,
  row?: Pick<{ role_context?: string | null; status?: string | null }, 'role_context' | 'status'> | null
): string | null {
  const r = (attemptResults ?? []).slice(0, 3);
  const rc = String(row?.role_context ?? '').trim();
  const st = String(row?.status ?? '').trim();
  // Next-attempt messaging only when the instance is back with the student (resubmission window open).
  const resubmissionOpen = rc === 'student' && st === 'draft';
  if (!resubmissionOpen) return null;
  if (r[0] === 'not_yet_competent' && !r[1] && !r[2]) return 'Second Attempt Required';
  if (r[1] === 'not_yet_competent' && !r[2]) return 'Third Attempt Required';
  if (r[2] === 'not_yet_competent') return 'No more attempts (contact admin)';
  return null;
}

export function getMissedAttemptWindowText(input: {
  noAttemptRollovers?: number | null;
  didNotAttempt?: boolean | null;
  status?: string | null;
  submissionCount?: number | null;
  submittedAt?: string | null;
  answerCount?: number | null;
  attemptResults?: AttemptResult[] | null;
  trainerAssessmentExists?: boolean | null;
  endDate?: string | null;
}): string | null {
  const display = calculateAssessmentDisplayStatus({
    status: input.status,
    did_not_attempt: input.didNotAttempt,
    no_attempt_rollovers: input.noAttemptRollovers,
    submission_count: input.submissionCount,
    submitted_at: input.submittedAt,
    answer_count: input.answerCount,
    attempt_results: input.attemptResults,
    trainer_assessment_exists: input.trainerAssessmentExists,
    end_date: input.endDate,
  });
  if (display.status === 'did_not_attempt' || display.status === 'saved_answers') return display.label;
  if (display.trainerAssessmentExists || display.submitted) return null;

  const rollovers = Math.max(0, Number(input.noAttemptRollovers ?? 0) || 0);
  if (rollovers <= 0) return null;
  if (rollovers >= 2) return 'Missed 1st attempt, 2nd attempt';
  return 'Missed 1st attempt';
}

/** Student row check: green only once any attempt is marked competent (not merely submitted). */
export function hasCompetentAttempt(results: (AttemptResult | null | undefined)[] | null | undefined): boolean {
  const r = (results ?? []).slice(0, 3);
  return r.some((x) => x === 'competent');
}

/** 0-based attempt slots missed by window rollover / terminal failure. */
export function getMissedAttemptIndexes(input: {
  no_attempt_rollovers?: number | null;
  noAttemptRollovers?: number | null;
  did_not_attempt?: boolean | null;
  didNotAttempt?: boolean | null;
}): Set<number> {
  const rollovers = Math.max(0, Number(input.no_attempt_rollovers ?? input.noAttemptRollovers ?? 0) || 0);
  const finalMiss = Boolean(input.did_not_attempt ?? input.didNotAttempt ?? false);
  const missed = new Set<number>();
  if (rollovers >= 1) missed.add(0);
  if (rollovers >= 2) missed.add(1);
  if (finalMiss && rollovers >= 2) missed.add(2);
  return missed;
}

/**
 * Missed deadline windows only occupy attempt slots while nothing has been handed in. Once the
 * student submits, attempt n is the n-th hand-in (summary column n) regardless of rollovers.
 */
function getMissedSlotsForDisplay(input: {
  no_attempt_rollovers?: number | null;
  did_not_attempt?: boolean | null;
  submittedAttempts: number;
}): Set<number> {
  if (input.submittedAttempts > 0) return new Set<number>();
  return getMissedAttemptIndexes(input);
}

export function getAdminOfficeDotTone(input: {
  status?: string | null;
  role_context?: string | null;
  workflow_status?: string | null;
  submission_count?: number | null;
  submitted_at?: string | null;
  did_not_attempt?: boolean | null;
  attemptResults: AttemptResult[];
  terminalDidNotAttempt?: boolean;
}): AttemptDotTone {
  if (input.terminalDidNotAttempt) return 'red';
  const { adminState } = computeWorkflowStageChecks(input);
  if (adminState === 'done') return 'green';
  if (adminState === 'pending') return 'yellow';
  return 'gray';
}

/** Progress column styling when all three attempt windows were missed. */
export function isTerminalFailureProgressRow(row: InstanceWorkflowRow): boolean {
  return calculateAssessmentDisplayStatus(row).terminalDidNotAttempt;
}

/** End-date extension reopens exhausted failures, but never resets a completed assessment. */
export function shouldAutoResetTerminalAssessmentOnEndDateChange(
  row: InstanceWorkflowRow,
  changingEnd: boolean,
): boolean {
  return (
    changingEnd &&
    calculateAssessmentFinalStatus(row).terminalDidNotAttempt &&
    String(row.workflow_status ?? '').trim() !== 'completed'
  );
}

export type AssessmentRowForAttemptReset = {
  did_not_attempt?: boolean | null;
  no_attempt_rollovers?: number | null;
  end_date?: string | null;
  submission_count?: number | null;
  submitted_at?: string | null;
};

/** True when end date is changing on an assessment with no attempts remaining (terminal / all 3 used). */
export function shouldPromptResetAttemptsOnEndDateChange(input: {
  row: AssessmentRowForAttemptReset;
  currentEnd: string | null | undefined;
  nextEnd: string | null | undefined;
  attemptResults?: AttemptResult[] | null;
}): boolean {
  const next = String(input.nextEnd ?? '').trim();
  const current = String(input.currentEnd ?? '').trim();
  if (!next || next === current) return false;

  const row = input.row;
  if (isTerminalFailureProgressRow(row)) return true;

  const r = (input.attemptResults ?? []).slice(0, 3);
  if (
    r[0] === 'not_yet_competent' &&
    r[1] === 'not_yet_competent' &&
    r[2] === 'not_yet_competent'
  ) {
    return true;
  }

  const submitted = Math.min(
    3,
    Math.max(0, Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0))
  );
  if (submitted >= 3 && !r.some((x) => x === 'competent')) return true;

  return false;
}

/**
 * Per-attempt dot. Attempt n = n-th hand-in = summary column n.
 *  - green: outcome competent recorded for that attempt
 *  - red: outcome NYC recorded, or a missed window before any hand-in
 *  - yellow (student): handed in and awaiting the trainer, or the next attempt the student must submit
 *  - yellow (trainer): handed in, with the trainer (or stuck before handoff), no outcome yet
 */
function toneForAttemptSlot(
  slotIndex: number,
  state: AssessmentWorkflowState,
  missed: Set<number>,
  studentNextYellow: number | null,
  column: 'student' | 'trainer',
): AttemptDotTone {
  if (missed.has(slotIndex)) return 'red';
  const attemptNum = slotIndex + 1;
  const outcome = state.results[slotIndex];
  if (outcome === 'competent') return 'green';
  if (outcome === 'not_yet_competent') return 'red';
  const submittedNoOutcome = attemptNum <= state.submittedAttempts;
  if (submittedNoOutcome) {
    if (column === 'student') return 'yellow';
    if (state.handoffStage === 'trainer' || state.handoffIncomplete) return 'yellow';
  }
  if (column === 'student' && studentNextYellow === slotIndex) return 'yellow';
  return 'gray';
}

export function computeAttemptTones(input: {
  submissionCount: number;
  results: AttemptResult[];
  /** When all three windows were missed — show all attempt dots red. */
  terminalDidNotAttempt?: boolean;
  role_context?: string | null;
  status?: string | null;
  workflow_status?: string | null;
  did_not_attempt?: boolean | null;
  no_attempt_rollovers?: number | null;
  currentAttemptNumber?: number | null;
}): { student: AttemptDotTone[]; trainer: AttemptDotTone[] } {
  if (input.terminalDidNotAttempt) {
    return { student: [...ALL_ATTEMPTS_FAILED_TONES], trainer: [...ALL_ATTEMPTS_FAILED_TONES] };
  }

  const state = resolveAssessmentWorkflowState({
    status: input.status,
    role_context: input.role_context,
    workflow_status: input.workflow_status,
    submission_count: input.submissionCount,
    attempt_results: input.results,
    did_not_attempt: input.did_not_attempt,
  });
  const missed = getMissedSlotsForDisplay({
    no_attempt_rollovers: input.no_attempt_rollovers,
    did_not_attempt: input.did_not_attempt,
    submittedAttempts: state.submittedAttempts,
  });

  // Next attempt the student has to hand in: a fresh start (attempt 1) or the attempt opened by an NYC.
  let studentNextYellow: number | null = null;
  if (state.handoffStage === 'student' && !state.studentSubmittedCurrent && !state.officeCompleted) {
    const candidate = state.currentAttempt - 1;
    for (let i = candidate; i < 3; i++) {
      if (!missed.has(i)) {
        studentNextYellow = i;
        break;
      }
    }
  }
  if (studentNextYellow == null && input.currentAttemptNumber != null && state.submittedAttempts === 0) {
    const idx = input.currentAttemptNumber - 1;
    if (idx >= 0 && idx < 3 && !missed.has(idx)) studentNextYellow = idx;
  }

  const student: AttemptDotTone[] = [0, 1, 2].map((i) =>
    toneForAttemptSlot(i, state, missed, studentNextYellow, 'student'),
  );
  const trainer: AttemptDotTone[] = [0, 1, 2].map((i) =>
    toneForAttemptSlot(i, state, missed, null, 'trainer'),
  );

  return { student, trainer };
}

