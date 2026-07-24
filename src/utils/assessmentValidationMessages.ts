/**
 * Student-facing assessment validation copy.
 * Display numbers must match getTaskQuestionDisplayNumbers / on-screen "Q{n}:".
 */

export type FormatAssessmentValidationErrorInput = {
  /** 1-based display number from getTaskQuestionDisplayNumbers; omit when no Q label is shown. */
  questionNumber?: number | null;
  questionTitle: string;
  /** Specific missing control (e.g. "Payment Date", "Table row 2, Amount"). */
  fieldLabel?: string | null;
  /** When > 1, prefer a consolidated question-level message. */
  missingCount?: number | null;
};

/** Matches on-screen numbering: `Q9:` (no leading zeros). */
export function formatDisplayQuestionNumber(n: number): string {
  return `Q${n}`;
}

function cleanTitle(title: string): string {
  return String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Central formatter for student assessment required-field messages.
 *
 * - No field: `Q9 – Interim Payment Claim is not completed.`
 * - One field: `Q9 – Interim Payment Claim: Payment Date is required.`
 * - Several: `Q9 – Interim Payment Claim is not completed (3 required fields missing).`
 */
export function formatAssessmentValidationError(
  input: FormatAssessmentValidationErrorInput
): string {
  const title = cleanTitle(input.questionTitle) || 'This question';
  const qPrefix =
    input.questionNumber != null && Number.isFinite(Number(input.questionNumber))
      ? `${formatDisplayQuestionNumber(Number(input.questionNumber))} – `
      : '';
  const missing = Number(input.missingCount ?? 0);
  const field = cleanTitle(input.fieldLabel ?? '');

  if (missing > 1) {
    return `${qPrefix}${title} is not completed (${missing} required fields missing).`;
  }
  if (field) {
    return `${qPrefix}${title}: ${field} is required.`;
  }
  return `${qPrefix}${title} is not completed.`;
}

/**
 * Submit/Next when several top-level questions fail.
 * Example: `3 questions are incomplete. Please complete Q9 – Interim Payment Claim first.`
 */
export function formatAssessmentValidationSummary(input: {
  incompleteCount: number;
  firstQuestionNumber?: number | null;
  firstQuestionTitle: string;
}): string {
  const count = Math.max(1, Math.floor(input.incompleteCount));
  const first = formatAssessmentValidationError({
    questionNumber: input.firstQuestionNumber,
    questionTitle: input.firstQuestionTitle,
  }).replace(/\.$/, '');
  // Strip trailing " is not completed" for the "complete X first" clause — keep Q – Title.
  const firstLabel = first.replace(/\s+is not completed$/i, '');
  if (count === 1) {
    return `${firstLabel} is not completed.`;
  }
  return `${count} questions are incomplete. Please complete ${firstLabel} first.`;
}

export type AssessmentQuestionErrorMeta = {
  errorKey: string;
  questionId: number;
  questionNumber?: number | null;
  questionTitle: string;
  message: string;
};

/** Prefer a single toast: one question → that message; many → summary pointing at the first. */
export function pickAssessmentValidationToast(
  questionErrors: AssessmentQuestionErrorMeta[]
): string {
  if (questionErrors.length === 0) return 'Please complete the required fields.';
  if (questionErrors.length === 1) return questionErrors[0].message;
  const first = questionErrors[0];
  return formatAssessmentValidationSummary({
    incompleteCount: questionErrors.length,
    firstQuestionNumber: first.questionNumber,
    firstQuestionTitle: first.questionTitle,
  });
}

export function scrollToAssessmentQuestion(questionId: number): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector<HTMLElement>(`[data-question-id="${questionId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    const focusable = el.querySelector<HTMLElement>(
      'textarea:not([disabled]):not([readonly]), input:not([disabled]):not([readonly]), select:not([disabled]), [contenteditable="true"]'
    );
    focusable?.focus({ preventScroll: true });
  }, 280);
}
