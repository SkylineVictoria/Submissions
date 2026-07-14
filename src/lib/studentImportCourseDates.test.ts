import { describe, expect, it } from 'vitest';
import {
  deriveCourseDatesFromActivityRows,
  maxIsoDate,
  minIsoDate,
  resolveCourseDatesAfterImport,
  validateActivityDatePair,
} from './studentImportCourseDates';
import { defaultStatusForNewCourse, defaultStatusForNewCourseEnrollment, findCourseOverlapConflicts } from './courseLifecycle';

describe('studentImportCourseDates', () => {
  it('derives course start as earliest unit start and end as latest unit end', () => {
    const derived = deriveCourseDatesFromActivityRows([
      { activity_start_date: '2026-02-02', activity_end_date: '2026-02-18' },
      { activity_start_date: '2026-02-09', activity_end_date: '2026-02-25' },
      { activity_start_date: '2026-02-23', activity_end_date: '2026-03-18' },
    ]);
    expect(derived.courseStartDate).toBe('2026-02-02');
    expect(derived.courseEndDate).toBe('2026-03-18');
    expect(derived.unitRowCount).toBe(3);
  });

  it('uses chronological MIN/MAX regardless of spreadsheet row order', () => {
    const derived = deriveCourseDatesFromActivityRows([
      { activity_start_date: '2026-02-23', activity_end_date: '2026-03-18' },
      { activity_start_date: '2026-02-02', activity_end_date: '2026-02-18' },
      { activity_start_date: '2026-02-09', activity_end_date: '2026-02-25' },
    ]);
    expect(derived.courseStartDate).toBe('2026-02-02');
    expect(derived.courseEndDate).toBe('2026-03-18');
  });

  it('minIsoDate / maxIsoDate ignore invalid values', () => {
    expect(minIsoDate(['2026-03-01', null, 'bad', '2026-01-15'])).toBe('2026-01-15');
    expect(maxIsoDate(['2026-03-01', '', '2026-01-15'])).toBe('2026-03-01');
    expect(minIsoDate([])).toBeNull();
  });

  it('rejects activity end before start with row label', () => {
    expect(validateActivityDatePair('2026-03-01', '2026-02-01', 'Row 4')).toMatch(/Row 4/);
    expect(validateActivityDatePair('2026-03-01', '2026-02-01')).toMatch(/cannot be before/i);
  });

  it('rejects one-sided activity dates', () => {
    expect(validateActivityDatePair('2026-03-01', null)).toMatch(/End Date is required/i);
    expect(validateActivityDatePair(null, '2026-03-01')).toMatch(/Start Date is required/i);
  });

  it('allows complete valid pairs and empty pairs', () => {
    expect(validateActivityDatePair('2026-02-01', '2026-02-28')).toBeNull();
    expect(validateActivityDatePair(null, null)).toBeNull();
  });

  it('does not invent dates when all unit starts/ends missing', () => {
    const derived = deriveCourseDatesFromActivityRows([
      { activity_start_date: null, activity_end_date: null },
      { activity_start_date: '', activity_end_date: undefined },
    ]);
    expect(derived.courseStartDate).toBeNull();
    expect(derived.courseEndDate).toBeNull();
    expect(derived.validStartCount).toBe(0);
    expect(derived.validEndCount).toBe(0);
  });

  it('preserves existing trusted dates when recompute has none (partial import with no dates)', () => {
    const resolved = resolveCourseDatesAfterImport({
      recomputedStart: null,
      recomputedEnd: null,
      existingStart: '2026-02-01',
      existingEnd: '2026-04-30',
    });
    expect(resolved).toEqual({ startDate: '2026-02-01', endDate: '2026-04-30' });
  });

  it('uses full DB range when recomputed (partial import must not shorten incorrectly)', () => {
    // Existing DB units 01/02–30/04; file only 01/03–31/03 → recompute returns full range
    const resolved = resolveCourseDatesAfterImport({
      recomputedStart: '2026-02-01',
      recomputedEnd: '2026-04-30',
      existingStart: '2026-02-01',
      existingEnd: '2026-04-30',
    });
    expect(resolved.startDate).toBe('2026-02-01');
    expect(resolved.endDate).toBe('2026-04-30');
  });

  it('extends course start when an earlier unit is added', () => {
    const resolved = resolveCourseDatesAfterImport({
      recomputedStart: '2026-01-15',
      recomputedEnd: '2026-04-30',
      existingStart: '2026-02-01',
      existingEnd: '2026-04-30',
    });
    expect(resolved.startDate).toBe('2026-01-15');
    expect(resolved.endDate).toBe('2026-04-30');
  });

  it('extends course end when a later unit is added', () => {
    const resolved = resolveCourseDatesAfterImport({
      recomputedStart: '2026-02-01',
      recomputedEnd: '2026-06-30',
      existingStart: '2026-02-01',
      existingEnd: '2026-04-30',
    });
    expect(resolved.startDate).toBe('2026-02-01');
    expect(resolved.endDate).toBe('2026-06-30');
  });

  it('keeps full range when import dates sit inside existing range', () => {
    const fromFileOnly = deriveCourseDatesFromActivityRows([
      { activity_start_date: '2026-03-01', activity_end_date: '2026-03-31' },
    ]);
    expect(fromFileOnly.courseStartDate).toBe('2026-03-01');
    // After DB recompute (existing + new), resolve uses recomputed full range:
    const resolved = resolveCourseDatesAfterImport({
      recomputedStart: '2026-02-01',
      recomputedEnd: '2026-04-30',
      existingStart: '2026-02-01',
      existingEnd: '2026-04-30',
    });
    expect(resolved.startDate).toBe('2026-02-01');
    expect(resolved.endDate).toBe('2026-04-30');
  });

  it('defaults second course to Tentative when another is In Progress', () => {
    expect(defaultStatusForNewCourse(true)).toBe('tentative');
    expect(defaultStatusForNewCourse(false)).toBe('in_progress');
  });

  it('defaults import enrolment without activity dates to Tentative (not In Progress)', () => {
    const derived = deriveCourseDatesFromActivityRows([
      { activity_start_date: null, activity_end_date: null },
    ]);
    expect(
      defaultStatusForNewCourseEnrollment({
        hasInProgress: false,
        startDate: derived.courseStartDate,
        endDate: derived.courseEndDate,
      })
    ).toBe('tentative');
    expect(
      defaultStatusForNewCourseEnrollment({
        hasInProgress: false,
        startDate: '2026-02-01',
        endDate: '2026-03-18',
      })
    ).toBe('in_progress');
  });

  it('detects overlapping course schedules for import rejection', () => {
    const conflicts = findCourseOverlapConflicts(
      { course_id: 2, start_date: '2026-03-01', end_date: '2026-06-01' },
      [
        {
          course_id: 1,
          start_date: '2026-02-01',
          end_date: '2026-04-30',
          enrollment_status: 'in_progress',
          name: 'Painting',
        },
      ],
    );
    expect(conflicts).toHaveLength(1);
  });

  it('allows non-overlapping multi-course ranges', () => {
    const conflicts = findCourseOverlapConflicts(
      { course_id: 2, start_date: '2026-05-10', end_date: '2026-12-20' },
      [
        {
          course_id: 1,
          start_date: '2026-02-01',
          end_date: '2026-04-30',
          enrollment_status: 'in_progress',
          name: 'Painting',
        },
      ],
    );
    expect(conflicts).toHaveLength(0);
  });

  it('rejects In Progress when dates are not derivable (caller rule)', () => {
    const derived = deriveCourseDatesFromActivityRows([{ activity_start_date: null, activity_end_date: null }]);
    const canBeInProgress = Boolean(derived.courseStartDate && derived.courseEndDate);
    expect(canBeInProgress).toBe(false);
  });
});
