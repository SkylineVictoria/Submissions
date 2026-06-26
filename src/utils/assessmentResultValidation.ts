import type { AssessmentSummaryDataEntry, ResultsDataEntry } from '../lib/formEngine';
import { buildTaskResultSections } from './taskResultsOutcome';
import type { FormTemplate } from '../lib/formEngine';

export const ASSESSMENT_RESULT_PROGRESS_MESSAGE =
  'Please record at least one valid attempt with both outcome and date in the Result Sheet and Assessment Summary Sheet before moving this assessment forward.';

function hasContent(value: string | null | undefined): boolean {
  return String(value ?? '').trim().length > 0;
}

export function isValidResultSheetOutcome(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim().toLowerCase();
  return v === 's' || v === 'ns' || v === 'satisfactory' || v === 'not_satisfactory';
}

export function isValidSummaryOutcome(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim().toLowerCase();
  return (
    v === 'competent' ||
    v === 'not_yet_competent' ||
    v === 'not_competent' ||
    v === 'not competent'
  );
}

/** At least one attempt has both S/NS outcome and date on a task Results Sheet. */
export function hasAtLeastOneValidResultSheetAttempt(
  rd: ResultsDataEntry | null | undefined,
): boolean {
  if (!rd) return false;
  const attempts = [
    { outcome: rd.first_attempt_satisfactory, date: rd.first_attempt_date },
    { outcome: rd.second_attempt_satisfactory, date: rd.second_attempt_date },
    { outcome: rd.third_attempt_satisfactory, date: rd.third_attempt_date },
  ];
  return attempts.some(
    (attempt) => isValidResultSheetOutcome(attempt.outcome) && hasContent(attempt.date),
  );
}

/** At least one attempt has both Competent/NYC outcome and trainer date on the summary sheet. */
export function hasAtLeastOneValidSummaryAttempt(
  sum: AssessmentSummaryDataEntry | null | undefined,
): boolean {
  if (!sum) return false;
  const attempts = [
    { outcome: sum.final_attempt_1_result, date: sum.trainer_date_1 },
    { outcome: sum.final_attempt_2_result, date: sum.trainer_date_2 },
    { outcome: sum.final_attempt_3_result, date: sum.trainer_date_3 },
  ];
  return attempts.some(
    (attempt) => isValidSummaryOutcome(attempt.outcome) && hasContent(attempt.date),
  );
}

export interface AssessmentProgressValidation {
  valid: boolean;
  missingResultSheetSectionIds: number[];
  missingSummarySheet: boolean;
  message: string | null;
}

export function validateAssessmentBeforeProgress(params: {
  template: FormTemplate | null;
  resultsData: Record<number, ResultsDataEntry>;
  assessmentSummary: AssessmentSummaryDataEntry | null;
}): AssessmentProgressValidation {
  const { template, resultsData, assessmentSummary } = params;
  const taskEntries = buildTaskResultSections(template, resultsData);
  const missingResultSheetSectionIds: number[] = [];

  for (const entry of taskEntries) {
    const sectionId = entry.sectionId;
    if (sectionId == null) continue;
    const rd = resultsData[sectionId];
    if (!hasAtLeastOneValidResultSheetAttempt(rd)) {
      missingResultSheetSectionIds.push(sectionId);
    }
  }

  const missingSummarySheet = !hasAtLeastOneValidSummaryAttempt(assessmentSummary);
  const valid = missingResultSheetSectionIds.length === 0 && !missingSummarySheet;

  return {
    valid,
    missingResultSheetSectionIds,
    missingSummarySheet,
    message: valid ? null : ASSESSMENT_RESULT_PROGRESS_MESSAGE,
  };
}

/** Toggle helper: click same outcome again → null. */
export function toggleOutcomeSelection<T extends string>(
  current: T | null | undefined,
  next: T,
): T | null {
  return current === next ? null : next;
}
