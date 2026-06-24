import { describe, expect, it } from 'vitest';
import {
  findDuplicateAssessmentTaskStepsByRowId,
  nextAssessmentTaskLabel,
  nextAssessmentTaskNumber,
} from './assessmentTaskSteps';

describe('nextAssessmentTaskNumber', () => {
  it('returns 1 when no existing labels', () => {
    expect(nextAssessmentTaskNumber([])).toBe(1);
  });

  it('returns max numbered task + 1', () => {
    expect(nextAssessmentTaskNumber(['Assessment Task - 1', 'Assessment Task - 2'])).toBe(3);
    expect(nextAssessmentTaskNumber(['Assessment Task 1', 'Other label'])).toBe(2);
  });
});

describe('nextAssessmentTaskLabel', () => {
  it('formats the next label', () => {
    expect(nextAssessmentTaskLabel(['Assessment Task - 1'])).toBe('Assessment Task - 2');
  });
});

describe('findDuplicateAssessmentTaskStepsByRowId', () => {
  it('detects multiple steps linked to the same row id', () => {
    const dups = findDuplicateAssessmentTaskStepsByRowId(42, [
      { stepId: 10, rowId: 5, title: 'Assessment Task - 1', sortOrder: 3 },
      { stepId: 11, rowId: 5, title: 'Assessment Task - 1', sortOrder: 4 },
      { stepId: 20, rowId: 6, title: 'Assessment Task - 2', sortOrder: 5 },
    ]);
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({
      formId: 42,
      assessmentTaskRowId: 5,
      stepIds: [10, 11],
    });
  });

  it('ignores unique row links', () => {
    const dups = findDuplicateAssessmentTaskStepsByRowId(1, [
      { stepId: 10, rowId: 5, title: 'Assessment Task - 1', sortOrder: 1 },
      { stepId: 20, rowId: 6, title: 'Assessment Task - 2', sortOrder: 2 },
    ]);
    expect(dups).toHaveLength(0);
  });
});
