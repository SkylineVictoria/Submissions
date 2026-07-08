import type { AssessmentSummaryDataEntry, ResultsDataEntry } from '../lib/formEngine';

/** Normalize calendar strings to yyyy-MM-dd for ordering (local date-only, no timezone shift). */
export function normalizeCalendarDateToIso(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return t.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{2}-\d{2}-\d{4}$/.test(t)) {
    const [dd, mm, yyyy] = t.split('-');
    if (dd && mm && yyyy && dd.length === 2 && mm.length === 2 && yyyy.length === 4) return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) {
    const [dd, mm, yyyy] = t.split('/');
    if (dd && mm && yyyy && dd.length === 2 && mm.length === 2 && yyyy.length === 4) return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

export function isCalendarBefore(a: string | null | undefined, b: string | null | undefined): boolean {
  const ai = normalizeCalendarDateToIso(a);
  const bi = normalizeCalendarDateToIso(b);
  if (!ai || !bi) return false;
  return ai < bi;
}

/** Latest of ISO yyyy-MM-dd strings. */
export function maxIsoDate(...vals: (string | null | undefined)[]): string | undefined {
  const norm = vals.map((v) => normalizeCalendarDateToIso(v)).filter((x): x is string => !!x);
  if (norm.length === 0) return undefined;
  return norm.reduce((a, b) => (a >= b ? a : b));
}

export function todayIsoLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** 1st attempt student date minimum (declaration date when present). */
export function getResultsMinFirstAttemptDate(
  _sum: AssessmentSummaryDataEntry | null | undefined,
  studentDeclarationIso?: string,
): string | undefined {
  return studentDeclarationIso || undefined;
}

/** Prior attempt trainer boundary: results footer trainer date, then summary trainer date. */
function getFirstAttemptTrainerDate(
  rd: ResultsDataEntry | null | undefined,
  sum: AssessmentSummaryDataEntry | null | undefined,
): string | undefined {
  return maxIsoDate(rd?.trainer_date ?? undefined, sum?.trainer_date_1 ?? undefined);
}

function getSecondAttemptTrainerDate(
  rd: ResultsDataEntry | null | undefined,
  sum: AssessmentSummaryDataEntry | null | undefined,
): string | undefined {
  return maxIsoDate(sum?.trainer_date_2 ?? undefined, rd?.second_attempt_date ?? undefined);
}

/** 2nd attempt student date: ≥ 1st trainer date, else ≥ 1st student date. */
export function getResultsMinSecondAttemptDate(
  rd: ResultsDataEntry | null | undefined,
  sum: AssessmentSummaryDataEntry | null | undefined,
): string | undefined {
  return maxIsoDate(getFirstAttemptTrainerDate(rd, sum), rd?.first_attempt_date ?? undefined);
}

/** 3rd attempt student date: ≥ 2nd trainer date, else ≥ 2nd student date. */
export function getResultsMinThirdAttemptDate(
  rd: ResultsDataEntry | null | undefined,
  sum: AssessmentSummaryDataEntry | null | undefined,
): string | undefined {
  return maxIsoDate(getSecondAttemptTrainerDate(rd, sum), rd?.second_attempt_date ?? undefined);
}

/** Results sheet footer trainer date must be ≥ 1st attempt student date. */
export function getResultsTrainerFooterDateMin(
  rd: ResultsDataEntry | null | undefined,
): string | undefined {
  return maxIsoDate(rd?.first_attempt_date ?? undefined);
}

/**
 * Assessment summary: S1 → T1 → S2 → T2 → S3 → T3.
 * Student N min uses prior trainer date when available, else prior student date.
 */
export function getAssessmentSummaryDateChainMins(
  sum: AssessmentSummaryDataEntry,
  studentDeclarationIso?: string,
): {
  minStudentDate1: string | undefined;
  minTrainerDate1: string | undefined;
  minStudentDate2: string | undefined;
  minTrainerDate2: string | undefined;
  minStudentDate3: string | undefined;
  minTrainerDate3: string | undefined;
} {
  const s1 = sum.student_date_1?.trim() || '';
  const t1 = sum.trainer_date_1?.trim() || '';
  const s2 = sum.student_date_2?.trim() || '';
  const t2 = sum.trainer_date_2?.trim() || '';
  const s3 = sum.student_date_3?.trim() || '';

  return {
    minStudentDate1: studentDeclarationIso || undefined,
    minTrainerDate1: maxIsoDate(s1 || undefined),
    minStudentDate2: maxIsoDate(t1 || undefined, s1 || undefined, studentDeclarationIso),
    minTrainerDate2: maxIsoDate(s2 || undefined, t1 || undefined),
    minStudentDate3: maxIsoDate(t2 || undefined, s2 || undefined),
    minTrainerDate3: maxIsoDate(s3 || undefined, t2 || undefined),
  };
}

export function validateAssessmentSummaryDateChain(
  sum: AssessmentSummaryDataEntry,
  studentDeclarationIso?: string,
): string | null {
  const s1 = sum.student_date_1?.trim();
  const t1 = sum.trainer_date_1?.trim();
  const s2 = sum.student_date_2?.trim();
  const t2 = sum.trainer_date_2?.trim();
  const s3 = sum.student_date_3?.trim();
  const t3 = sum.trainer_date_3?.trim();

  if (studentDeclarationIso && s1 && isCalendarBefore(s1, studentDeclarationIso)) {
    return 'Student date (attempt 1) cannot be before the student declaration date.';
  }
  if (s1 && t1 && isCalendarBefore(t1, s1)) {
    return 'Summary trainer date cannot be before the related student date.';
  }
  if (t1 && s2 && isCalendarBefore(s2, t1)) {
    return '2nd attempt student date cannot be before the 1st attempt trainer date.';
  }
  if (!t1 && s1 && s2 && isCalendarBefore(s2, s1)) {
    return '2nd attempt student date cannot be before the 1st attempt student date.';
  }
  if (s2 && t2 && isCalendarBefore(t2, s2)) {
    return 'Summary trainer date cannot be before the related student date.';
  }
  if (t2 && s3 && isCalendarBefore(s3, t2)) {
    return '3rd attempt student date cannot be before the 2nd attempt trainer date.';
  }
  if (!t2 && s2 && s3 && isCalendarBefore(s3, s2)) {
    return '3rd attempt student date cannot be before the 2nd attempt student date.';
  }
  if (s3 && t3 && isCalendarBefore(t3, s3)) {
    return 'Summary trainer date cannot be before the related student date.';
  }
  return null;
}

export function getSummarySheetFieldDateErrors(
  sum: AssessmentSummaryDataEntry,
  studentDeclarationIso?: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const mins = getAssessmentSummaryDateChainMins(sum, studentDeclarationIso);

  const check = (field: string, value: string | null | undefined, min: string | undefined, message: string) => {
    const v = String(value ?? '').trim();
    if (!v || !min) return;
    if (isCalendarBefore(v, min)) errors[field] = message;
  };

  check('summary-student_date_1', sum.student_date_1, mins.minStudentDate1, 'Student date (attempt 1) cannot be before the student declaration date.');
  check('summary-trainer_date_1', sum.trainer_date_1, mins.minTrainerDate1, 'Summary trainer date cannot be before the related student date.');
  check(
    'summary-student_date_2',
    sum.student_date_2,
    mins.minStudentDate2,
    sum.trainer_date_1?.trim()
      ? '2nd attempt student date cannot be before the 1st attempt trainer date.'
      : '2nd attempt student date cannot be before the 1st attempt student date.',
  );
  check('summary-trainer_date_2', sum.trainer_date_2, mins.minTrainerDate2, 'Summary trainer date cannot be before the related student date.');
  check(
    'summary-student_date_3',
    sum.student_date_3,
    mins.minStudentDate3,
    sum.trainer_date_2?.trim()
      ? '3rd attempt student date cannot be before the 2nd attempt trainer date.'
      : '3rd attempt student date cannot be before the 2nd attempt student date.',
  );
  check('summary-trainer_date_3', sum.trainer_date_3, mins.minTrainerDate3, 'Summary trainer date cannot be before the related student date.');

  return errors;
}

export function validateResultsSheetDateChain(
  rd: ResultsDataEntry | null | undefined,
  sum: AssessmentSummaryDataEntry | null | undefined,
  studentDeclarationIso?: string,
): string | null {
  if (!rd) return null;

  const fieldErrors = getResultsSheetFieldDateErrors(rd, sum, studentDeclarationIso);
  const first = Object.values(fieldErrors)[0];
  return first ?? null;
}

export function getResultsSheetFieldDateErrors(
  rd: ResultsDataEntry | null | undefined,
  sum: AssessmentSummaryDataEntry | null | undefined,
  studentDeclarationIso?: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!rd?.section_id) return errors;
  const prefix = `results-${rd.section_id}`;

  const min1 = getResultsMinFirstAttemptDate(sum, studentDeclarationIso);
  if (rd.first_attempt_date && min1 && isCalendarBefore(rd.first_attempt_date, min1)) {
    errors[`${prefix}-first_attempt_date`] = 'First attempt date must be on or after the student declaration date.';
  }

  const minTrainer = getResultsTrainerFooterDateMin(rd);
  if (rd.trainer_date && minTrainer && isCalendarBefore(rd.trainer_date, minTrainer)) {
    errors[`${prefix}-trainer_date`] = 'Trainer date cannot be before the student attempt date.';
  }

  const min2 = getResultsMinSecondAttemptDate(rd, sum);
  if (rd.second_attempt_date && min2 && isCalendarBefore(rd.second_attempt_date, min2)) {
    const hasFirstTrainer = Boolean(getFirstAttemptTrainerDate(rd, sum));
    errors[`${prefix}-second_attempt_date`] = hasFirstTrainer
      ? '2nd attempt student date cannot be before the 1st attempt trainer date.'
      : '2nd attempt student date cannot be before the 1st attempt student date.';
  }

  const min3 = getResultsMinThirdAttemptDate(rd, sum);
  if (rd.third_attempt_date && min3 && isCalendarBefore(rd.third_attempt_date, min3)) {
    const hasSecondTrainer = Boolean(getSecondAttemptTrainerDate(rd, sum));
    errors[`${prefix}-third_attempt_date`] = hasSecondTrainer
      ? '3rd attempt student date cannot be before the 2nd attempt trainer date.'
      : '3rd attempt student date cannot be before the 2nd attempt student date.';
  }

  return errors;
}

export type QuickEditDateValidationInput = {
  resultsSections: Array<{ sectionId: number | null }>;
  resultsData: Record<number, ResultsDataEntry>;
  assessmentSummary: AssessmentSummaryDataEntry;
  studentDeclarationIso?: string;
};

export function collectQuickEditDateValidationErrors(input: QuickEditDateValidationInput): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const entry of input.resultsSections) {
    if (entry.sectionId == null) continue;
    const rd = input.resultsData[entry.sectionId];
    Object.assign(errors, getResultsSheetFieldDateErrors(rd, input.assessmentSummary, input.studentDeclarationIso));
  }
  Object.assign(errors, getSummarySheetFieldDateErrors(input.assessmentSummary, input.studentDeclarationIso));
  const chainErr = validateAssessmentSummaryDateChain(input.assessmentSummary, input.studentDeclarationIso);
  if (chainErr) errors['summary-chain'] = chainErr;
  return errors;
}

export function extractStudentDeclarationIso(
  answers: Record<string, unknown>,
  getAnswerKey: (questionId: number, rowId: number | null) => string,
  declarationQuestionId: number | null,
): string | undefined {
  if (declarationQuestionId == null) return undefined;
  const val = answers[getAnswerKey(declarationQuestionId, null)];
  if (val == null) return undefined;
  if (typeof val === 'string') return normalizeCalendarDateToIso(val) ?? undefined;
  if (typeof val === 'object' && !Array.isArray(val)) {
    const o = val as Record<string, unknown>;
    const d = String(o.date ?? o.signedAtDate ?? '').trim();
    return normalizeCalendarDateToIso(d) ?? undefined;
  }
  return undefined;
}
