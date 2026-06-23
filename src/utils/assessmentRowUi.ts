import { formatIsoDateOnly, formatMelbourneDateTime, isTimestampIso, MELBOURNE_TZ } from './melbourneTime';

export type AttemptResult = 'competent' | 'not_yet_competent' | null;

export type AttemptDotTone = 'green' | 'red' | 'yellow' | 'gray';

export type AssessmentRowUiState =
  | { kind: 'future'; disabled: true; reason: string; rowClassName: string; outcomeLabel?: never; outcomeClassName?: never }
  | { kind: 'in_progress'; disabled: false; rowClassName: string; outcomeLabel?: never; outcomeClassName?: never }
  | { kind: 'past_competent'; disabled: false; rowClassName: string; outcomeLabel: string; outcomeClassName: string }
  | { kind: 'past_not_competent'; disabled: boolean; rowClassName: string; outcomeLabel: string; outcomeClassName: string }
  | { kind: 'did_not_attempt'; disabled: true; reason: string; rowClassName: string; outcomeLabel: string; outcomeClassName: string }
  | { kind: 'expired'; disabled: true; reason: string; rowClassName: string; outcomeLabel?: never; outcomeClassName?: never }
  | { kind: 'unknown'; disabled: false; rowClassName: string; outcomeLabel?: never; outcomeClassName?: never };

export type RowWindowInput = {
  start_date?: string | null;
  end_date?: string | null;
  did_not_attempt?: boolean | null;
  no_attempt_rollovers?: number | null;
  status?: string | null;
  role_context?: string | null;
};

/** All three submission windows missed — terminal failure (no competent path). */
export function isDidNotAttemptAnyFailure(input: {
  didNotAttempt?: boolean | null;
  noAttemptRollovers?: number | null;
}): boolean {
  const rollovers = Math.max(0, Number(input.noAttemptRollovers ?? 0) || 0);
  return Boolean(input.didNotAttempt ?? false) && rollovers >= 2;
}

/** Strong red row when the student exhausted all attempts without a successful submission path. */
export const TERMINAL_DID_NOT_ATTEMPT_ROW_CLASS =
  'bg-red-100 text-red-950 border-l-4 border-red-600 opacity-95 cursor-not-allowed';

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
};

/** Workflow badge label; `did_not_attempt` is terminal and must not show as "Waiting Office". */
export function getInstanceWorkflowLabel(
  row: InstanceWorkflowRow,
  opts?: { submittedFallback?: string },
): string {
  if (Boolean(row.did_not_attempt)) return 'Did not attempt';
  const status = String(row.status ?? '').trim();
  const rc = String(row.role_context ?? '').trim();
  if (status === 'locked') return 'Completed';
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
  if (Boolean(row.did_not_attempt)) return `${border}bg-red-50 text-red-800`.trim();
  const status = String(row.status ?? '').trim();
  const rc = String(row.role_context ?? '').trim();
  if (status === 'locked') {
    return `${border}${opts?.withBorder ? 'bg-emerald-50 text-emerald-800' : 'bg-emerald-100 text-emerald-800'}`.trim();
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
  const end = String(row.end_date ?? '').trim();
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
  const end = String(input.row.end_date ?? '').trim();
  const didNotAttempt = Boolean(input.row.did_not_attempt ?? false);
  const missedAllWindows = isDidNotAttemptAnyFailure({
    didNotAttempt: didNotAttempt,
    noAttemptRollovers: input.row.no_attempt_rollovers,
  });

  const r = (input.attemptResults ?? []).slice(0, 3);
  const anyCompetent = r.some((x) => x === 'competent');
  const anyNYC = r.some((x) => x === 'not_yet_competent');
  const rc = String(input.row.role_context ?? '').trim();
  const st = String(input.row.status ?? '').trim();
  const submitted = getSubmittedAttemptCount({
    submissionCount: input.submissionCount,
    submittedAt: input.submittedAt,
  });
  const trainerReviewing = rc === 'trainer' && st !== 'locked' && submitted > 0;

  // Terminal missed-all-windows overrides summary NYC/auto-sync — student failed, all attempts gone.
  if (missedAllWindows || didNotAttempt) {
    return {
      kind: 'did_not_attempt',
      disabled: true,
      reason: missedAllWindows ? "Didn't attempt any" : 'Did not attempt',
      rowClassName: TERMINAL_DID_NOT_ATTEMPT_ROW_CLASS,
      outcomeLabel: missedAllWindows ? "Didn't attempt any" : 'Did not attempt',
      outcomeClassName: 'text-red-800 font-semibold',
    };
  }

  // Outcome takes precedence over window state.
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
  if (anyNYC) {
    // Prior NYC exists but trainer is still marking a resubmission — stay in progress, not terminal red.
    if (trainerReviewing) {
      return {
        kind: 'in_progress',
        disabled: false,
        rowClassName:
          'bg-amber-50/70 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors',
      };
    }
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

export type WorkflowStageState = 'done' | 'pending' | 'idle';

export function computeWorkflowStageChecks(input: {
  status?: string | null;
  role_context?: string | null;
  attemptResults: AttemptResult[];
}): { studentDone: boolean; trainerDone: boolean; adminState: WorkflowStageState } {
  const hasCompetent = hasCompetentAttempt(input.attemptResults);
  const isLocked = String(input.status ?? '').trim() === 'locked';
  const rc = String(input.role_context ?? '').trim();
  const awaitingOffice = !isLocked && (rc === 'office' || hasCompetent);
  return {
    studentDone: hasCompetent,
    trainerDone: isLocked || rc === 'office' || hasCompetent,
    adminState: isLocked ? 'done' : awaitingOffice ? 'pending' : 'idle',
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
  const r = (input.attemptResults ?? []).slice(0, 3);
  const isLocked = String(input.status ?? '').trim() === 'locked';
  const anyCompetent = r.some((x) => x === 'competent');
  const anyNYC = r.some((x) => x === 'not_yet_competent');
  const rc = String(input.role_context ?? '').trim();
  const st = String(input.status ?? '').trim();
  const submitted = getSubmittedAttemptCount({
    submissionCount: input.submissionCount,
    submittedAt: input.submittedAt,
  });
  const trainerReviewing = rc === 'trainer' && st !== 'locked' && submitted > 0;

  if (anyCompetent) {
    if (isLocked) {
      return {
        label: 'Completed',
        className: 'text-emerald-700',
        subtext: null,
        subtextClassName: '',
      };
    }
    return {
      label: 'Competent',
      className: 'text-emerald-700',
      subtext: 'Office',
      subtextClassName: 'text-[11px] font-medium text-amber-700',
    };
  }
  if (anyNYC) {
    if (trainerReviewing) {
      return {
        label: 'In progress',
        className: 'text-amber-800',
        subtext: 'Trainer',
        subtextClassName: 'text-[11px] font-medium text-amber-700',
      };
    }
    return {
      label: 'Not competent',
      className: 'text-red-700',
      subtext: null,
      subtextClassName: '',
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
  return { label: 'In progress', className: 'text-gray-700', subtext: null, subtextClassName: '' };
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

function formatAwaitingTrainerText(attemptNum: number): string {
  if (attemptNum >= 3) return 'Submitted 3rd attempt — awaiting trainer';
  if (attemptNum >= 2) return 'Submitted 2nd attempt — awaiting trainer';
  return 'Submitted 1st attempt — awaiting trainer';
}

/** Highest submitted attempt still with the trainer (unmarked or marked NYC, not yet sent back). */
export function getAwaitingTrainerAttemptNumber(input: {
  submissionCount?: number | null;
  submittedAt?: string | null;
  attemptResults?: AttemptResult[] | null;
}): number | null {
  const submitted = getSubmittedAttemptCount(input);
  if (submitted <= 0) return null;
  const r = (input.attemptResults ?? []).slice(0, 3);
  for (let i = submitted - 1; i >= 0; i--) {
    if (r[i] === null || r[i] === 'not_yet_competent') return i + 1;
  }
  return submitted;
}

export function getStudentAttemptDoneText(input: {
  submissionCount?: number | null;
  submittedAt?: string | null;
  attemptResults?: AttemptResult[] | null;
  status?: string | null;
  role_context?: string | null;
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
}): string | null {
  if (isDidNotAttemptAnyFailure(input)) return "Didn't attempt any";

  const rollovers = Math.max(0, Number(input.noAttemptRollovers ?? 0) || 0);
  const finalMiss = Boolean(input.didNotAttempt ?? false);

  // rollovers: 0 = none missed, 1 = missed 1st window, 2 = missed 1st+2nd windows
  // didNotAttempt: final (3rd) window missed as well.
  if (!finalMiss && rollovers <= 0) return null;

  const missed: string[] = [];
  if (rollovers >= 1) missed.push('1st attempt');
  if (rollovers >= 2) missed.push('2nd attempt');
  if (finalMiss) missed.push('3rd attempt');
  if (missed.length === 0) return null;

  return `Missed ${missed.join(', ')}`;
}

/** Student row check: green only once any attempt is marked competent (not merely submitted). */
export function hasCompetentAttempt(results: (AttemptResult | null | undefined)[] | null | undefined): boolean {
  const r = (results ?? []).slice(0, 3);
  return r.some((x) => x === 'competent');
}

/**
 * While the instance is still with the trainer (`role_context === 'trainer'`), the summary may already
 * contain `competent` from auto-sync before the trainer submits to office. Dashboard UI should not show
 * green "Completed" / competent styling until the trainer finishes their review (handoff to office or terminal lock).
 * NYC remains visible so resubmission messaging stays accurate.
 */
export function maskCompetentWhileAwaitingTrainer(
  row: Pick<{ role_context?: string; status?: string }, 'role_context' | 'status'>,
  results: (AttemptResult | null | undefined)[] | null | undefined,
): AttemptResult[] {
  const triple = [...(results ?? []), null, null, null].slice(0, 3).map((x) =>
    x === 'competent' || x === 'not_yet_competent' ? x : null,
  ) as AttemptResult[];
  const rc = String(row.role_context ?? '').trim();
  const st = String(row.status ?? '').trim();
  const awaitingTrainer = rc === 'trainer' && st !== 'locked';
  if (!awaitingTrainer) return triple;
  return triple.map((x) => (x === 'competent' ? null : x));
}

function isWaitingTrainerMark(r: AttemptResult[], submitted: number, slotIndex: number): boolean {
  if (r[slotIndex] !== null) return false;
  return submitted >= slotIndex + 1;
}

/**
 * Which student attempt slot should show as "next" (yellow): only when the student may submit that attempt,
 * not while an earlier attempt is still awaiting trainer marking (avoids yellow on attempt 2 while attempt 1 is pending).
 */
function computeStudentNextYellowIndex(r: AttemptResult[], submitted: number): number | null {
  if (r.some((x) => x === 'competent')) return null;
  // Submitted attempt not yet marked — do not show yellow on a later attempt slot.
  for (let s = 0; s < submitted; s++) {
    if (r[s] === null) return null;
  }
  for (let i = 0; i < 3; i++) {
    if (r[i] === 'competent') return null;
    if (r[i] === 'not_yet_competent') continue;
    // r[i] === null
    for (let j = 0; j < i; j++) {
      if (r[j] === null) return null;
    }
    if (isWaitingTrainerMark(r, submitted, i)) continue;
    return i;
  }
  return null;
}

export function getAdminOfficeDotTone(input: {
  status?: string | null;
  role_context?: string | null;
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
export function isTerminalFailureProgressRow(row: {
  did_not_attempt?: boolean | null;
  no_attempt_rollovers?: number | null;
}): boolean {
  return (
    isDidNotAttemptAnyFailure({
      didNotAttempt: row.did_not_attempt,
      noAttemptRollovers: row.no_attempt_rollovers,
    }) || Boolean(row.did_not_attempt)
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
  if (Boolean(row.did_not_attempt)) return true;

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

function getTrainerActiveReviewAttempt(
  role_context: string | null | undefined,
  status: string | null | undefined,
  submissionCount: number,
  results: AttemptResult[],
): number | null {
  const rc = String(role_context ?? '').trim();
  const st = String(status ?? '').trim();
  if (rc !== 'trainer' || st === 'locked') return null;
  return getAwaitingTrainerAttemptNumber({
    submissionCount,
    submittedAt: null,
    attemptResults: results,
  });
}

function toneForAttemptSlot(
  slotIndex: number,
  r: AttemptResult[],
  submitted: number,
  trainerActiveReview: number | null,
  studentNextYellow: number | null,
): AttemptDotTone {
  const attemptNum = slotIndex + 1;

  // Current attempt with trainer: yellow while reviewing; green once all tasks satisfactory.
  if (trainerActiveReview === attemptNum) {
    if (r[slotIndex] === 'competent') return 'green';
    return 'yellow';
  }

  if (r[slotIndex] === 'competent') return 'green';
  if (r[slotIndex] === 'not_yet_competent') return 'red';
  if (slotIndex < submitted) return 'yellow';
  if (studentNextYellow === slotIndex) return 'yellow';
  return 'gray';
}

export function computeAttemptTones(input: {
  submissionCount: number;
  results: AttemptResult[];
  /** When all three windows were missed — show all attempt dots red. */
  terminalDidNotAttempt?: boolean;
  role_context?: string | null;
  status?: string | null;
}): { student: AttemptDotTone[]; trainer: AttemptDotTone[] } {
  if (input.terminalDidNotAttempt) {
    return { student: [...ALL_ATTEMPTS_FAILED_TONES], trainer: [...ALL_ATTEMPTS_FAILED_TONES] };
  }

  const submitted = Math.min(3, Math.max(0, Number(input.submissionCount) || 0));
  const r = [...input.results, null, null, null].slice(0, 3) as AttemptResult[];
  const rc = String(input.role_context ?? '').trim();

  const trainerActiveReview = getTrainerActiveReviewAttempt(input.role_context, input.status, submitted, r);

  // Next-attempt yellow only when the instance is back with the student — not while trainer is reviewing.
  const studentNextYellow = rc === 'trainer' ? null : computeStudentNextYellowIndex(r, submitted);

  const student: AttemptDotTone[] = [0, 1, 2].map((i) =>
    toneForAttemptSlot(i, r, submitted, trainerActiveReview, studentNextYellow),
  );

  const trainer: AttemptDotTone[] = [0, 1, 2].map((i) =>
    toneForAttemptSlot(i, r, submitted, trainerActiveReview, null),
  );

  return { student, trainer };
}

