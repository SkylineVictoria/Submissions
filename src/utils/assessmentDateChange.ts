import {
  extendInstanceAccessTokensToDate,
  fetchAssessmentSummaries,
  updateFormInstanceDates,
  type SubmittedInstanceRow,
} from '../lib/formEngine';
import {
  shouldPromptResetAttemptsOnEndDateChange,
  type AttemptResult,
} from './assessmentRowUi';

export const END_DATE_RESET_DIALOG_TITLE = 'Reset assessment attempts?';
export const END_DATE_RESET_DIALOG_MESSAGE =
  'This assessment has used all three attempts. Changing the end date will reset it to attempt 1, clear attempt history, and return the assessment to the student.';

export function endDateChanged(
  row: Pick<SubmittedInstanceRow, 'end_date'>,
  nextEnd: string | null
): boolean {
  const next = String(nextEnd ?? '').trim();
  const current = String(row.end_date ?? '').trim();
  return Boolean(next) && next !== current;
}

export async function getAttemptResultsForInstance(instanceId: number): Promise<AttemptResult[]> {
  const summaries = await fetchAssessmentSummaries([instanceId]);
  const sum = summaries[instanceId];
  if (!sum) return [];
  return [
    (sum.final_attempt_1_result as AttemptResult) ?? null,
    (sum.final_attempt_2_result as AttemptResult) ?? null,
    (sum.final_attempt_3_result as AttemptResult) ?? null,
  ];
}

export async function needsResetPromptOnEndDateChange(
  row: SubmittedInstanceRow,
  nextEnd: string | null
): Promise<boolean> {
  if (!endDateChanged(row, nextEnd)) return false;
  const attemptResults = await getAttemptResultsForInstance(row.id);
  return shouldPromptResetAttemptsOnEndDateChange({
    row,
    currentEnd: row.end_date,
    nextEnd,
    attemptResults,
  });
}

export async function commitAssessmentDateChange(
  instanceId: number,
  dates: { start_date: string | null; end_date: string | null },
  opts: { resetAttempts?: boolean }
): Promise<void> {
  await updateFormInstanceDates(instanceId, dates, { resetAttempts: opts.resetAttempts });
  if (dates.end_date) {
    await extendInstanceAccessTokensToDate(instanceId, 'student', dates.end_date);
  }
}
