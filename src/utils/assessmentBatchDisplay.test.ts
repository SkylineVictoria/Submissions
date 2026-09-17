import { describe, expect, it } from 'vitest';
import { getAssessmentBatchName, groupAssessmentsByBatch } from './assessmentBatchDisplay';

describe('getAssessmentBatchName', () => {
  it('displays the assigned student batch', () => {
    expect(
      getAssessmentBatchName({ batch_name: 'CPC30220_Carpentry_Mashood Rasul' }),
    ).toBe('CPC30220_Carpentry_Mashood Rasul');
  });

  it('gracefully handles a student without a batch', () => {
    expect(getAssessmentBatchName({ batch_name: null })).toBe('No batch assigned');
  });

  it('keeps the correct batch against students from multiple batches', () => {
    const rows = [
      { student_name: 'Student A', batch_name: 'Batch Alpha' },
      { student_name: 'Student B', batch_name: 'Batch Beta' },
    ];

    expect(rows.map((row) => [row.student_name, getAssessmentBatchName(row)])).toEqual([
      ['Student A', 'Batch Alpha'],
      ['Student B', 'Batch Beta'],
    ]);
  });

  it('groups the same unit student rows by their existing batch relationship', () => {
    const groups = groupAssessmentsByBatch([
      { id: 1, batch_id: 10, batch_name: 'Batch Alpha', student_name: 'Student A' },
      { id: 2, batch_id: 20, batch_name: 'Batch Beta', student_name: 'Student B' },
      { id: 3, batch_id: 10, batch_name: 'Batch Alpha', student_name: 'Student C' },
    ]);

    expect(groups.map((group) => [group.batchName, group.rows.map((row) => row.id)])).toEqual([
      ['Batch Alpha', [1, 3]],
      ['Batch Beta', [2]],
    ]);
  });
});
