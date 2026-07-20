import { describe, expect, it } from 'vitest';
import {
  hasOtherInProgress,
  resolveImportCourseDraft,
  resolveImportCourseDraftsForStudent,
  formatAlreadyInProgressError,
  findImportOverlapConflictsExcludingSelf,
  type ExistingEnrollmentLite,
} from './studentImportEnrollment';
import { resolveCourseDatesAfterImport } from './studentImportCourseDates';

const painting: ExistingEnrollmentLite = {
  course_id: 10,
  enrollment_status: 'in_progress',
  start_date: '2026-02-02',
  end_date: '2026-06-30',
  name: 'Painting',
  qualification_code: 'CPC50220',
};

describe('studentImportEnrollment — same-course timetable', () => {
  it('reuses existing In Progress course without duplicate In Progress error', () => {
    const r = resolveImportCourseDraft({
      courseId: 10,
      existingEnrollments: [painting],
      fileStartDate: '2026-07-01',
      fileEndDate: '2027-07-18',
      statusRaw: null,
      studentLabel: '13129437',
      courseLabel: 'CPC50220',
    });
    expect(r.error).toBeUndefined();
    expect(r.isExisting).toBe(true);
    expect(r.enrollment_status).toBeNull();
    expect(r.action).toBe('update_existing_timetable');
    expect(r.actionLabel).toMatch(/Update Existing Course Timetable/i);
    expect(r.proposedStatusLabel).toMatch(/Preserve In Progress/i);
  });

  it('treats same status explicitly supplied as no lifecycle change', () => {
    const r = resolveImportCourseDraft({
      courseId: 10,
      existingEnrollments: [painting],
      fileStartDate: '2026-07-01',
      fileEndDate: '2027-07-18',
      statusRaw: 'In Progress',
      studentLabel: '13129437',
      courseLabel: 'CPC50220',
    });
    expect(r.error).toBeUndefined();
    expect(r.isExisting).toBe(true);
    expect(r.enrollment_status).toBeNull();
    expect(r.action).toBe('update_existing_timetable');
  });

  it('excludes self from other-in-progress check', () => {
    expect(hasOtherInProgress([painting], 10)).toBe(false);
    expect(hasOtherInProgress([painting], 99)).toBe(true);
  });

  it('overlap validation excludes self by course_id', () => {
    const conflicts = findImportOverlapConflictsExcludingSelf(
      { course_id: 10, start_date: '2026-02-02', end_date: '2027-07-18' },
      [
        {
          course_id: 10,
          start_date: '2026-02-02',
          end_date: '2026-06-30',
          enrollment_status: 'in_progress',
          qualification_code: 'CPC50220',
        },
        {
          course_id: 20,
          start_date: '2027-06-01',
          end_date: '2027-11-30',
          enrollment_status: 'tentative',
          qualification_code: 'CPC30220',
        },
      ]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].course_id).toBe(20);
  });

  it('expands course end date when later units are imported (preview merge)', () => {
    const resolved = resolveCourseDatesAfterImport({
      recomputedStart: '2026-02-02',
      recomputedEnd: '2027-07-18',
      existingStart: '2026-02-02',
      existingEnd: '2026-06-30',
    });
    expect(resolved.startDate).toBe('2026-02-02');
    expect(resolved.endDate).toBe('2027-07-18');
  });

  it('expands course start date when earlier units are imported', () => {
    const resolved = resolveCourseDatesAfterImport({
      recomputedStart: '2026-01-01',
      recomputedEnd: '2026-06-30',
      existingStart: '2026-02-02',
      existingEnd: '2026-06-30',
    });
    expect(resolved.startDate).toBe('2026-01-01');
    expect(resolved.endDate).toBe('2026-06-30');
  });
});

describe('studentImportEnrollment — different course', () => {
  it('defaults new different course to Tentative while another is In Progress', () => {
    const r = resolveImportCourseDraft({
      courseId: 20,
      existingEnrollments: [painting],
      fileStartDate: '2027-08-01',
      fileEndDate: '2028-01-31',
      statusRaw: null,
      studentLabel: '13129437',
      courseLabel: 'CPC30220',
    });
    expect(r.error).toBeUndefined();
    expect(r.isExisting).toBe(false);
    expect(r.enrollment_status).toBe('tentative');
    expect(r.action).toBe('create_new_tentative');
  });

  it('rejects different course explicitly marked In Progress', () => {
    const r = resolveImportCourseDraft({
      courseId: 20,
      existingEnrollments: [painting],
      fileStartDate: '2027-08-01',
      fileEndDate: '2028-01-31',
      statusRaw: 'In Progress',
      studentLabel: '13129437',
      courseLabel: 'CPC30220',
    });
    expect(r.action).toBe('error');
    expect(r.error).toMatch(/already has CPC50220 In Progress/i);
    expect(r.error).toMatch(/cannot also be In Progress/i);
  });

  it('formats already-in-progress error clearly', () => {
    expect(formatAlreadyInProgressError('13129437', painting, 'CPC30220')).toMatch(
      /Student 13129437 already has CPC50220 In Progress/
    );
  });
});

describe('studentImportEnrollment — multi-course file resolution', () => {
  it('keeps existing In Progress and makes second new course Tentative', () => {
    const results = resolveImportCourseDraftsForStudent({
      studentLabel: '13129437',
      existingEnrollments: [painting],
      courses: [
        {
          courseId: 10,
          courseLabel: 'CPC50220',
          fileStartDate: '2026-07-01',
          fileEndDate: '2027-07-18',
          statusRaw: null,
        },
        {
          courseId: 20,
          courseLabel: 'CPC30220',
          fileStartDate: '2027-08-01',
          fileEndDate: '2028-01-31',
          statusRaw: null,
        },
      ],
    });
    expect(results[0].action).toBe('update_existing_timetable');
    expect(results[0].enrollment_status).toBeNull();
    expect(results[1].action).toBe('create_new_tentative');
    expect(results[1].enrollment_status).toBe('tentative');
    expect(results.every((r) => !r.error)).toBe(true);
  });
});
