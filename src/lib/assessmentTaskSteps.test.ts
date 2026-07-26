import { describe, expect, it } from 'vitest';
import {
  findDuplicateAssessmentTaskStepsByRowId,
  legacyIncorrectDuplicateRenumberLabels,
  nextAssessmentTaskLabel,
  nextAssessmentTaskNumber,
  planFormScopedAssessmentTaskLabelRepair,
  preserveAssessmentTaskLabelsOnFormDuplicate,
} from './assessmentTaskSteps';

describe('nextAssessmentTaskNumber', () => {
  it('returns 1 when no existing labels', () => {
    expect(nextAssessmentTaskNumber([])).toBe(1);
  });

  it('returns max numbered task + 1 (form-scoped labels only)', () => {
    expect(nextAssessmentTaskNumber(['Assessment Task - 1', 'Assessment Task - 2'])).toBe(3);
    expect(nextAssessmentTaskNumber(['Assessment Task 1', 'Other label'])).toBe(2);
  });
});

describe('nextAssessmentTaskLabel', () => {
  it('formats the next label from the current form only', () => {
    expect(nextAssessmentTaskLabel(['Assessment Task - 1'])).toBe('Assessment Task - 2');
    expect(nextAssessmentTaskLabel(['Assessment Task - 1', 'Assessment Task - 2'])).toBe(
      'Assessment Task - 3'
    );
  });
});

describe('form duplication must preserve local task labels', () => {
  it('preserves Assessment Task 1 and 2 across any number of conceptual copies', () => {
    const source = ['Assessment Task - 1', 'Assessment Task - 2'];
    let labels = source;
    for (let copy = 1; copy <= 10; copy++) {
      labels = preserveAssessmentTaskLabelsOnFormDuplicate(labels);
      expect(labels).toEqual(['Assessment Task - 1', 'Assessment Task - 2']);
    }
  });

  it('preserves four tasks as 1–4 on every duplicate', () => {
    const source = [
      'Assessment Task - 1',
      'Assessment Task - 2',
      'Assessment Task - 3',
      'Assessment Task - 4',
    ];
    expect(preserveAssessmentTaskLabelsOnFormDuplicate(source)).toEqual(source);
  });

  it('preserves custom task titles including suffixes', () => {
    const source = [
      'Assessment Task - 1 – Written Questions',
      'Assessment Task - 2 – Practical Observation',
    ];
    expect(preserveAssessmentTaskLabelsOnFormDuplicate(source)).toEqual(source);
  });

  it('documents why the old renumber pass was wrong (1,2 → 3,4 → 5,6)', () => {
    const afterCopy1 = legacyIncorrectDuplicateRenumberLabels([
      'Assessment Task - 1',
      'Assessment Task - 2',
    ]);
    expect(afterCopy1).toEqual(['Assessment Task - 3', 'Assessment Task - 4']);
    const afterCopy2 = legacyIncorrectDuplicateRenumberLabels(afterCopy1);
    expect(afterCopy2).toEqual(['Assessment Task - 5', 'Assessment Task - 6']);
    // Correct behaviour never applies that pass:
    expect(
      preserveAssessmentTaskLabelsOnFormDuplicate(['Assessment Task - 1', 'Assessment Task - 2'])
    ).toEqual(['Assessment Task - 1', 'Assessment Task - 2']);
  });
});

describe('planFormScopedAssessmentTaskLabelRepair', () => {
  it('renumbers bad copy labels 3,4 → 1,2 by local sort_order', () => {
    const plans = planFormScopedAssessmentTaskLabelRepair([
      { id: 10, row_label: 'Assessment Task - 3', sort_order: 0 },
      { id: 11, row_label: 'Assessment Task - 4', sort_order: 1 },
    ]);
    expect(plans).toEqual([
      { id: 10, from: 'Assessment Task - 3', to: 'Assessment Task - 1' },
      { id: 11, from: 'Assessment Task - 4', to: 'Assessment Task - 2' },
    ]);
  });

  it('preserves custom suffixes while renumbering', () => {
    const plans = planFormScopedAssessmentTaskLabelRepair([
      { id: 1, row_label: 'Assessment Task - 5 – Knowledge Questions', sort_order: 0 },
      { id: 2, row_label: 'Assessment Task - 6 – Practical', sort_order: 1 },
    ]);
    expect(plans).toEqual([
      { id: 1, from: 'Assessment Task - 5 – Knowledge Questions', to: 'Assessment Task - 1 – Knowledge Questions' },
      { id: 2, from: 'Assessment Task - 6 – Practical', to: 'Assessment Task - 2 – Practical' },
    ]);
  });

  it('does not rewrite fully custom titles', () => {
    const plans = planFormScopedAssessmentTaskLabelRepair([
      { id: 1, row_label: 'Written knowledge evidence', sort_order: 0 },
      { id: 2, row_label: 'Assessment Task - 4', sort_order: 1 },
    ]);
    expect(plans).toEqual([{ id: 2, from: 'Assessment Task - 4', to: 'Assessment Task - 1' }]);
  });

  it('returns empty when labels already match local order', () => {
    expect(
      planFormScopedAssessmentTaskLabelRepair([
        { id: 1, row_label: 'Assessment Task - 1', sort_order: 0 },
        { id: 2, row_label: 'Assessment Task - 2', sort_order: 1 },
      ])
    ).toEqual([]);
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
