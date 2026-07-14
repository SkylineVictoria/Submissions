import { describe, expect, it } from 'vitest';
import {
  allowedNextCourseStatuses,
  canTransitionCourseStatus,
  courseDateRangesOverlap,
  defaultStatusForNewCourse,
  defaultStatusForNewCourseEnrollment,
  findCourseOverlapConflicts,
  normalizeCourseLifecycleStatus,
  validateCourseDateOrder,
  ERROR_ALREADY_IN_PROGRESS,
} from './courseLifecycle';

/** Pure ranking helper mirroring migration backfill (for unit tests). */
export function rankCoursesForLifecycle(courses: Array<{
  course_id: number;
  earliest_instance_start: string | null;
  earliest_instance_end: string | null;
  earliest_instance_created_at: string | null;
  enrolment_created_at: string;
}>): Array<{ course_id: number; rank: number; status: 'in_progress' | 'tentative' }> {
  const sorted = [...courses].sort((a, b) => {
    const aHas = a.earliest_instance_start ? 0 : 1;
    const bHas = b.earliest_instance_start ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    const cmp = (x: string | null, y: string | null) => {
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return x < y ? -1 : x > y ? 1 : 0;
    };
    let c = cmp(a.earliest_instance_start, b.earliest_instance_start);
    if (c !== 0) return c;
    c = cmp(a.earliest_instance_end, b.earliest_instance_end);
    if (c !== 0) return c;
    c = cmp(a.earliest_instance_created_at, b.earliest_instance_created_at);
    if (c !== 0) return c;
    c = a.enrolment_created_at < b.enrolment_created_at ? -1 : a.enrolment_created_at > b.enrolment_created_at ? 1 : 0;
    if (c !== 0) return c;
    return a.course_id - b.course_id;
  });
  return sorted.map((c, i) => ({
    course_id: c.course_id,
    rank: i + 1,
    status: i === 0 ? 'in_progress' : 'tentative',
  }));
}

describe('courseLifecycle', () => {
  it('normalises status variants', () => {
    expect(normalizeCourseLifecycleStatus('In Progress')).toBe('in_progress');
    expect(normalizeCourseLifecycleStatus('in progress')).toBe('in_progress');
    expect(normalizeCourseLifecycleStatus('tentative')).toBe('tentative');
    expect(normalizeCourseLifecycleStatus('Cancelled')).toBe('cancelled');
    expect(normalizeCourseLifecycleStatus('nope')).toBeNull();
  });

  it('enforces allowed transitions', () => {
    expect(canTransitionCourseStatus('tentative', 'in_progress')).toBe(true);
    expect(canTransitionCourseStatus('tentative', 'completed')).toBe(false);
    expect(canTransitionCourseStatus('in_progress', 'suspended')).toBe(true);
    expect(canTransitionCourseStatus('completed', 'in_progress')).toBe(false);
    expect(allowedNextCourseStatuses('suspended')).toEqual(['in_progress', 'completed', 'cancelled']);
  });

  it('validates date order and inclusive overlap', () => {
    expect(validateCourseDateOrder('2026-02-18', '2026-02-01')).toMatch(/cannot be before/i);
    expect(courseDateRangesOverlap('2026-02-01', '2026-02-18', '2026-02-18', '2026-03-01')).toBe(true);
    expect(courseDateRangesOverlap('2026-02-01', '2026-02-18', '2026-02-19', '2026-03-01')).toBe(false);
  });

  it('defaults new course to Tentative when another is In Progress', () => {
    expect(defaultStatusForNewCourse(true)).toBe('tentative');
    expect(defaultStatusForNewCourse(false)).toBe('in_progress');
  });

  it('ranks painting before carpentry by earliest instance start', () => {
    const ranked = rankCoursesForLifecycle([
      {
        course_id: 2,
        earliest_instance_start: '2026-05-10',
        earliest_instance_end: '2026-08-01',
        earliest_instance_created_at: '2026-01-02',
        enrolment_created_at: '2026-01-01',
      },
      {
        course_id: 1,
        earliest_instance_start: '2026-02-01',
        earliest_instance_end: '2026-04-01',
        earliest_instance_created_at: '2026-01-01',
        enrolment_created_at: '2026-01-02',
      },
    ]);
    expect(ranked[0]).toMatchObject({ course_id: 1, status: 'in_progress' });
    expect(ranked[1]).toMatchObject({ course_id: 2, status: 'tentative' });
  });

  it('prefers dated course over undated', () => {
    const ranked = rankCoursesForLifecycle([
      {
        course_id: 9,
        earliest_instance_start: null,
        earliest_instance_end: null,
        earliest_instance_created_at: null,
        enrolment_created_at: '2025-01-01',
      },
      {
        course_id: 8,
        earliest_instance_start: '2026-03-01',
        earliest_instance_end: '2026-06-01',
        earliest_instance_created_at: '2026-02-01',
        enrolment_created_at: '2026-02-01',
      },
    ]);
    expect(ranked[0].course_id).toBe(8);
    expect(ranked[0].status).toBe('in_progress');
    expect(ranked[1].status).toBe('tentative');
  });

  it('selects exactly one in_progress when no dates (deterministic)', () => {
    const ranked = rankCoursesForLifecycle([
      {
        course_id: 5,
        earliest_instance_start: null,
        earliest_instance_end: null,
        earliest_instance_created_at: null,
        enrolment_created_at: '2026-02-01',
      },
      {
        course_id: 4,
        earliest_instance_start: null,
        earliest_instance_end: null,
        earliest_instance_created_at: null,
        enrolment_created_at: '2026-01-01',
      },
    ]);
    expect(ranked.filter((r) => r.status === 'in_progress')).toHaveLength(1);
    expect(ranked[0].course_id).toBe(4);
  });

  it('detects overlap conflicts excluding cancelled and self', () => {
    const conflicts = findCourseOverlapConflicts(
      { course_id: 1, start_date: '2026-02-01', end_date: '2026-02-18' },
      [
        {
          course_id: 1,
          start_date: '2026-02-01',
          end_date: '2026-02-18',
          enrollment_status: 'in_progress',
          name: 'Self',
        },
        {
          course_id: 2,
          start_date: '2026-02-10',
          end_date: '2026-03-01',
          enrollment_status: 'tentative',
          name: 'Overlap',
          qualification_code: 'CPC30220',
        },
        {
          course_id: 3,
          start_date: '2026-02-01',
          end_date: '2026-02-18',
          enrollment_status: 'cancelled',
          name: 'Cancelled',
        },
      ]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].course_id).toBe(2);
    expect(ERROR_ALREADY_IN_PROGRESS).toMatch(/in progress/i);
  });

  it('defaults new enrolment without dates to Tentative', () => {
    expect(
      defaultStatusForNewCourseEnrollment({ hasInProgress: false, startDate: null, endDate: null })
    ).toBe('tentative');
    expect(
      defaultStatusForNewCourseEnrollment({
        hasInProgress: false,
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    ).toBe('in_progress');
    expect(
      defaultStatusForNewCourseEnrollment({
        hasInProgress: true,
        startDate: '2026-01-01',
        endDate: '2026-06-01',
      })
    ).toBe('tentative');
    expect(
      defaultStatusForNewCourseEnrollment({
        hasInProgress: false,
        startDate: null,
        endDate: null,
        explicitStatus: 'in_progress',
      })
    ).toBe('tentative');
  });
});
