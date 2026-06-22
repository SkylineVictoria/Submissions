import { describe, expect, it } from 'vitest';
import {
  BATCH_STUDENT_COURSE_MISMATCH,
  mergeCourseIds,
  normalizeImportStudentId,
  partitionStudentsByBatchCourse,
} from './studentBatchValidation';

describe('normalizeImportStudentId', () => {
  it('trims outer spaces and preserves inner content', () => {
    expect(normalizeImportStudentId('  00123  ')).toBe('00123');
  });

  it('returns empty for blank', () => {
    expect(normalizeImportStudentId('   ')).toBe('');
  });
});

describe('mergeCourseIds', () => {
  it('appends new courses without removing existing', () => {
    expect(mergeCourseIds([1, 2], [2, 3])).toEqual([1, 2, 3]);
  });

  it('dedupes duplicate Student ID imports with same course', () => {
    expect(mergeCourseIds([5], [5])).toEqual([5]);
  });
});

describe('partitionStudentsByBatchCourse', () => {
  const enrolled = new Map<number, number[]>([
    [10, [1, 2]],
    [11, [2]],
    [12, [3]],
  ]);

  it('allows student enrolled in batch course', () => {
    const { valid, invalid } = partitionStudentsByBatchCourse([10, 11], enrolled, 2);
    expect(valid).toEqual([10, 11]);
    expect(invalid).toEqual([]);
  });

  it('rejects student not enrolled in batch course', () => {
    const { valid, invalid } = partitionStudentsByBatchCourse([12], enrolled, 2);
    expect(valid).toEqual([]);
    expect(invalid).toEqual([12]);
  });
});

describe('BATCH_STUDENT_COURSE_MISMATCH', () => {
  it('has expected message', () => {
    expect(BATCH_STUDENT_COURSE_MISMATCH).toContain('not enrolled in the batch course');
  });
});
