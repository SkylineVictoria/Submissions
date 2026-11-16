/**
 * Single source of truth for an assessment's per-attempt workflow state.
 *
 * Every Progress-column icon, attempt dot, Comments label and the Admin check queue derive
 * from `resolveAssessmentWorkflowState`. The SQL side mirrors the same rule in
 * `public.skyline_assessment_current_attempt` / `public.skyline_assessment_trainer_outcome`
 * (see migration 20261116120000_assessment_stage_single_source_of_truth.sql). Keep them in sync.
 *
 * State rule (per attempt):
 *   student submitted → trainer in progress → trainer completed (outcome recorded for that attempt)
 *   → admin pending (trainer's final submit handed the instance to office) → admin completed.
 *
 * Attempt numbering: attempt n is the n-th student hand-in and is recorded in summary column n
 * (`final_attempt_n_result`). Missed deadline windows (`no_attempt_rollovers`) extend the deadline;
 * they do not consume an attempt slot once the student has handed something in.
 *
 * Only a Not Yet Competent outcome opens the next attempt, so `submission_count` is capped by the
 * NYC chain: a stray extra hand-in (admin "Resubmit", duplicate submit) can never move the trainer
 * to a column they have not reached.
 */

export type AttemptResult = 'competent' | 'not_yet_competent' | null;
export type AttemptNumber = 1 | 2 | 3;
export type WorkflowStageState = 'done' | 'pending' | 'idle';
export type InstanceHandoffStage = 'student' | 'trainer' | 'office' | 'locked';

export type AssessmentWorkflowInput = {
  status?: string | null;
  role_context?: string | null;
  workflow_status?: string | null;
  submission_count?: number | null;
  submitted_at?: string | null;
  did_not_attempt?: boolean | null;
  attempt_results?: (AttemptResult | string | null | undefined)[] | null;
  office_assessment_completed?: boolean | null;
  office_status?: string | null;
};

export type AssessmentWorkflowState = {
  /** Normalized `[attempt1, attempt2, attempt3]` outcomes. */
  results: AttemptResult[];
  /** Attempt the workflow is currently on (1-based; summary column index). */
  currentAttempt: AttemptNumber;
  /** Effective student hand-ins, capped by the NYC chain (0..3). */
  submittedAttempts: number;
  /** Raw hand-in count from the instance row (0..3), before capping. */
  rawSubmittedAttempts: number;
  /** Where the instance row currently sits. */
  handoffStage: InstanceHandoffStage;
  /** Outcome recorded for the current attempt. */
  trainerOutcome: Exclude<AttemptResult, null> | null;
  /** Last outcome recorded on any attempt (legacy label fallback). */
  lastRecordedOutcome: Exclude<AttemptResult, null> | null;
  /** Student has handed in the current attempt. */
  studentSubmittedCurrent: boolean;
  /** Student submitted but the row never left the student stage (stuck handoff). */
  handoffIncomplete: boolean;
  /** Trainer recorded an outcome for the current attempt. */
  trainerReviewComplete: boolean;
  /** Trainer's final submit moved the instance to office (or beyond). */
  trainerHandedOff: boolean;
  /** Office finalised the assessment. */
  officeCompleted: boolean;
  /** Student must (re)submit: previous attempt NYC and the next hand-in is outstanding. */
  resubmissionRequired: boolean;
  studentStage: WorkflowStageState;
  trainerStage: WorkflowStageState;
  adminStage: WorkflowStageState;
  /** Row belongs in the Admin check queue. */
  adminQueueEligible: boolean;
};

export function normalizeAttemptResults(
  results: (AttemptResult | string | null | undefined)[] | null | undefined,
): AttemptResult[] {
  return [0, 1, 2].map((i) => {
    const raw = results?.[i];
    const v = raw == null ? '' : String(raw).trim().toLowerCase();
    if (v === 'competent') return 'competent';
    if (v === 'not_yet_competent' || v === 'not_competent' || v === 'not competent') return 'not_yet_competent';
    return null;
  });
}

/** Raw hand-in count from the instance row (0..3). */
export function getRawSubmittedAttempts(input: {
  submission_count?: number | null;
  submitted_at?: string | null;
}): number {
  const fromCount = Number(input.submission_count ?? 0) || 0;
  const fromDate = String(input.submitted_at ?? '').trim() ? 1 : 0;
  return Math.min(3, Math.max(0, fromCount || fromDate));
}

/** Number of leading Not Yet Competent outcomes (attempt 1, then 2, then 3). */
export function countLeadingNotYetCompetent(results: AttemptResult[]): number {
  let n = 0;
  for (const r of results) {
    if (r === 'not_yet_competent') n += 1;
    else break;
  }
  return n;
}

export function getInstanceHandoffStage(input: {
  status?: string | null;
  role_context?: string | null;
}): InstanceHandoffStage {
  const status = String(input.status ?? '').trim();
  const rc = String(input.role_context ?? '').trim();
  if (status === 'locked') return 'locked';
  if (rc === 'office') return 'office';
  if (rc === 'trainer') return 'trainer';
  return 'student';
}

/**
 * Attempt the workflow is on.
 *  - With the student: the attempt after the NYC chain (attempt 1 when nothing was marked NYC).
 *  - With trainer / office / locked: the latest hand-in that the NYC chain has opened, so an
 *    inflated `submission_count` never pushes the trainer past the attempt they marked.
 */
export function resolveCurrentAttempt(input: {
  results: AttemptResult[];
  rawSubmittedAttempts: number;
  handoffStage: InstanceHandoffStage;
}): AttemptNumber {
  const openedByNyc = Math.min(3, countLeadingNotYetCompetent(input.results) + 1);
  if (input.handoffStage === 'student') return openedByNyc as AttemptNumber;
  const handedIn = Math.max(1, Math.min(3, input.rawSubmittedAttempts));
  return Math.max(1, Math.min(openedByNyc, handedIn)) as AttemptNumber;
}

/**
 * Effective hand-in count for marking / display: `submission_count` capped by the attempts the
 * NYC chain has actually opened. This is what InstanceFillPage uses as its submission wave.
 */
export function resolveEffectiveSubmissionCount(input: {
  submission_count?: number | null;
  submitted_at?: string | null;
  attempt_results?: (AttemptResult | string | null | undefined)[] | null;
  status?: string | null;
  role_context?: string | null;
}): number {
  const results = normalizeAttemptResults(input.attempt_results);
  const raw = getRawSubmittedAttempts(input);
  if (raw <= 0) return 0;
  const handoffStage = getInstanceHandoffStage(input);
  const current = resolveCurrentAttempt({ results, rawSubmittedAttempts: raw, handoffStage });
  return Math.min(raw, current);
}

export function resolveAssessmentWorkflowState(input: AssessmentWorkflowInput): AssessmentWorkflowState {
  const results = normalizeAttemptResults(input.attempt_results);
  const rawSubmittedAttempts = getRawSubmittedAttempts(input);
  const handoffStage = getInstanceHandoffStage(input);
  const currentAttempt = resolveCurrentAttempt({ results, rawSubmittedAttempts, handoffStage });
  const submittedAttempts = Math.min(rawSubmittedAttempts, currentAttempt);
  const trainerOutcome = results[currentAttempt - 1] ?? null;
  const recorded = results.filter((r): r is Exclude<AttemptResult, null> => r != null);
  const lastRecordedOutcome = recorded.length > 0 ? recorded[recorded.length - 1] : null;

  const legacyStatus = String(input.status ?? '').trim();
  const role = String(input.role_context ?? '').trim();
  const workflow = String(input.workflow_status ?? '').trim();
  const didNotAttempt = Boolean(input.did_not_attempt);

  const officeCompleted =
    workflow === 'completed' ||
    String(input.office_status ?? '').trim() === 'completed' ||
    Boolean(input.office_assessment_completed) ||
    (legacyStatus === 'locked' && role === 'office' && trainerOutcome === 'competent');

  const studentSubmittedCurrent = submittedAttempts >= currentAttempt;
  const handoffIncomplete =
    handoffStage === 'student' && legacyStatus === 'draft' && submittedAttempts > 0 && studentSubmittedCurrent;
  const trainerReviewComplete = trainerOutcome !== null;
  const trainerHandedOff = handoffStage === 'office' || handoffStage === 'locked';
  const resubmissionRequired =
    !officeCompleted &&
    handoffStage === 'student' &&
    countLeadingNotYetCompetent(results) > 0 &&
    countLeadingNotYetCompetent(results) < 3 &&
    !studentSubmittedCurrent;

  const studentStage: WorkflowStageState = officeCompleted
    ? 'done'
    : studentSubmittedCurrent
      ? 'done'
      : resubmissionRequired
        ? 'pending'
        : 'idle';

  const trainerStage: WorkflowStageState = officeCompleted
    ? 'done'
    : trainerReviewComplete || trainerHandedOff
      ? 'done'
      : (handoffStage === 'trainer' && submittedAttempts > 0) || handoffIncomplete
        ? 'pending'
        : 'idle';

  const adminStage: WorkflowStageState = officeCompleted
    ? 'done'
    : handoffStage === 'office' && trainerReviewComplete && !didNotAttempt
      ? 'pending'
      : 'idle';

  return {
    results,
    currentAttempt,
    submittedAttempts,
    rawSubmittedAttempts,
    handoffStage,
    trainerOutcome,
    lastRecordedOutcome,
    studentSubmittedCurrent,
    handoffIncomplete,
    trainerReviewComplete,
    trainerHandedOff,
    officeCompleted,
    resubmissionRequired,
    studentStage,
    trainerStage,
    adminStage,
    adminQueueEligible: adminStage === 'pending',
  };
}
