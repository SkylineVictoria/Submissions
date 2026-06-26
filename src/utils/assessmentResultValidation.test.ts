import { describe, expect, it } from 'vitest';
import {
  hasAtLeastOneValidResultSheetAttempt,
  hasAtLeastOneValidSummaryAttempt,
  toggleOutcomeSelection,
} from './assessmentResultValidation';
import type { AssessmentSummaryDataEntry, ResultsDataEntry } from '../lib/formEngine';

const baseRd = (overrides: Partial<ResultsDataEntry> = {}): ResultsDataEntry => ({
  section_id: 1,
  first_attempt_satisfactory: null,
  first_attempt_date: null,
  first_attempt_feedback: null,
  second_attempt_satisfactory: null,
  second_attempt_date: null,
  second_attempt_feedback: null,
  third_attempt_satisfactory: null,
  third_attempt_date: null,
  third_attempt_feedback: null,
  student_name: null,
  student_signature: null,
  trainer_name: null,
  trainer_signature: null,
  trainer_date: null,
  ...overrides,
});

const baseSum = (overrides: Partial<AssessmentSummaryDataEntry> = {}): AssessmentSummaryDataEntry => ({
  start_date: null,
  end_date: null,
  final_attempt_1_result: null,
  final_attempt_2_result: null,
  final_attempt_3_result: null,
  trainer_sig_1: null,
  trainer_date_1: null,
  trainer_sig_2: null,
  trainer_date_2: null,
  trainer_sig_3: null,
  trainer_date_3: null,
  student_sig_1: null,
  student_date_1: null,
  student_sig_2: null,
  student_date_2: null,
  student_sig_3: null,
  student_date_3: null,
  student_overall_feedback: null,
  admin_initials: null,
  ...overrides,
});

describe('hasAtLeastOneValidResultSheetAttempt', () => {
  it('accepts any attempt with outcome and date', () => {
    expect(
      hasAtLeastOneValidResultSheetAttempt(
        baseRd({ second_attempt_satisfactory: 'ns', second_attempt_date: '2026-01-15' }),
      ),
    ).toBe(true);
  });

  it('rejects outcome without date', () => {
    expect(hasAtLeastOneValidResultSheetAttempt(baseRd({ first_attempt_satisfactory: 's' }))).toBe(false);
  });

  it('rejects date without outcome', () => {
    expect(hasAtLeastOneValidResultSheetAttempt(baseRd({ first_attempt_date: '2026-01-15' }))).toBe(false);
  });
});

describe('hasAtLeastOneValidSummaryAttempt', () => {
  it('accepts competent with trainer date on attempt 3', () => {
    expect(
      hasAtLeastOneValidSummaryAttempt(
        baseSum({ final_attempt_3_result: 'competent', trainer_date_3: '2026-02-01' }),
      ),
    ).toBe(true);
  });

  it('rejects partial attempt rows', () => {
    expect(hasAtLeastOneValidSummaryAttempt(baseSum({ final_attempt_1_result: 'competent' }))).toBe(false);
  });
});

describe('toggleOutcomeSelection', () => {
  it('clears when clicking the same value', () => {
    expect(toggleOutcomeSelection('s', 's')).toBeNull();
    expect(toggleOutcomeSelection('competent', 'competent')).toBeNull();
  });

  it('sets when clicking a different value', () => {
    expect(toggleOutcomeSelection('s', 'ns')).toBe('ns');
    expect(toggleOutcomeSelection(null, 's')).toBe('s');
  });
});
