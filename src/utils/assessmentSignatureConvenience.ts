import type { AssessmentSummaryDataEntry, ResultsDataEntry } from '../lib/formEngine';
import { todayIsoLocal } from './assessmentAttemptDates';

function isNonEmpty(value: string | null | undefined): boolean {
  return String(value ?? '').trim().length > 0;
}

function hasSignatureValue(sig: string | null | undefined): boolean {
  return isNonEmpty(sig);
}

/** Auto-fill student name when signature is first added (only if name empty). */
export function applyResultsStudentSignatureConvenience(
  current: ResultsDataEntry,
  patch: Partial<ResultsDataEntry>,
  studentName: string | null | undefined,
): Partial<ResultsDataEntry> {
  if (!hasSignatureValue(patch.student_signature ?? undefined)) return patch;
  const out = { ...patch };
  if (!isNonEmpty(current.student_name) && isNonEmpty(studentName ?? undefined)) {
    out.student_name = String(studentName).trim();
  }
  return out;
}

/** Auto-fill trainer name/date when signature is first added (only if empty). */
export function applyResultsTrainerSignatureConvenience(
  current: ResultsDataEntry,
  patch: Partial<ResultsDataEntry>,
  trainerName: string | null | undefined,
): Partial<ResultsDataEntry> {
  if (!hasSignatureValue(patch.trainer_signature ?? undefined)) return patch;
  const out = { ...patch };
  if (!isNonEmpty(current.trainer_name) && isNonEmpty(trainerName ?? undefined)) {
    out.trainer_name = String(trainerName).trim();
  }
  if (!isNonEmpty(current.trainer_date)) {
    out.trainer_date = todayIsoLocal();
  }
  return out;
}

type SummarySigField = 'student_sig_1' | 'student_sig_2' | 'student_sig_3';
type SummaryDateField = 'student_date_1' | 'student_date_2' | 'student_date_3';
type SummaryTrainerSigField = 'trainer_sig_1' | 'trainer_sig_2' | 'trainer_sig_3';
type SummaryTrainerDateField = 'trainer_date_1' | 'trainer_date_2' | 'trainer_date_3';

export function applySummaryStudentSignatureConvenience(
  current: AssessmentSummaryDataEntry,
  sigField: SummarySigField,
  dateField: SummaryDateField,
  sig: string | null,
): Partial<AssessmentSummaryDataEntry> {
  const patch: Partial<AssessmentSummaryDataEntry> = { [sigField]: sig };
  if (hasSignatureValue(sig) && !isNonEmpty(current[dateField])) {
    patch[dateField] = todayIsoLocal();
  }
  return patch;
}

export function applySummaryTrainerSignatureConvenience(
  current: AssessmentSummaryDataEntry,
  sigField: SummaryTrainerSigField,
  dateField: SummaryTrainerDateField,
  sig: string | null,
): Partial<AssessmentSummaryDataEntry> {
  const patch: Partial<AssessmentSummaryDataEntry> = { [sigField]: sig };
  if (hasSignatureValue(sig) && !isNonEmpty(current[dateField])) {
    patch[dateField] = todayIsoLocal();
  }
  return patch;
}
