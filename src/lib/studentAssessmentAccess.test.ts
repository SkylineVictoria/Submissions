import { describe, expect, it } from 'vitest';
import {
  canAccessCourseUnit,
  evaluateStudentCourseRunningAccess,
  isNonStudentEffectiveRole,
  MSG_COURSE_CANCELLED,
  MSG_COURSE_COMPLETED,
  MSG_COURSE_NOT_IN_PROGRESS,
  MSG_COURSE_SUSPENDED,
  MSG_COURSE_TENTATIVE,
  studentMayMutateAssessment,
  studentMayOpenAssessment,
} from './studentAssessmentAccess';

const TODAY = '2026-07-13';

function evalAccess(
  partial: Partial<Parameters<typeof evaluateStudentCourseRunningAccess>[0]> = {},
) {
  return evaluateStudentCourseRunningAccess({
    linkStatus: 'active',
    enrollmentStatus: 'in_progress',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    todayMelbourneIso: TODAY,
    ...partial,
  });
}

describe('evaluateStudentCourseRunningAccess', () => {
  it('allows student in_progress course when today is inside inclusive range', () => {
    const access = evalAccess();
    expect(access.allowed).toBe(true);
    expect(access.canMutate).toBe(true);
    expect(access.blockedByCourseLifecycle).toBe(false);
    expect(access.reason).toBe('allowed');
    expect(studentMayMutateAssessment(access)).toBe(true);
    expect(studentMayOpenAssessment(access)).toBe(true);
  });

  it('allows exactly on course_start_date and course_end_date', () => {
    expect(evalAccess({ startDate: TODAY, endDate: '2026-12-31' }).canMutate).toBe(true);
    expect(evalAccess({ startDate: '2026-01-01', endDate: TODAY }).canMutate).toBe(true);
  });

  it('blocks in_progress before course start', () => {
    const access = evalAccess({ startDate: '2026-08-01', endDate: '2026-12-31' });
    expect(access.canMutate).toBe(false);
    expect(access.reason).toBe('course_not_started');
    expect(access.message).toBe(MSG_COURSE_NOT_IN_PROGRESS);
    expect(access.code).toBe('COURSE_NOT_IN_PROGRESS');
  });

  it('blocks in_progress after course end', () => {
    const access = evalAccess({ startDate: '2026-01-01', endDate: '2026-06-01' });
    expect(access.canMutate).toBe(false);
    expect(access.reason).toBe('course_ended');
    expect(access.message).toBe(MSG_COURSE_NOT_IN_PROGRESS);
  });

  it('blocks tentative with specific message and no open', () => {
    const access = evalAccess({ enrollmentStatus: 'tentative' });
    expect(access.reason).toBe('course_tentative');
    expect(access.message).toBe(MSG_COURSE_TENTATIVE);
    expect(studentMayOpenAssessment(access)).toBe(false);
    expect(access.canOpenReadOnly).toBe(false);
  });

  it('blocks suspended with suspended message', () => {
    const access = evalAccess({ enrollmentStatus: 'suspended' });
    expect(access.reason).toBe('course_suspended');
    expect(access.message).toBe(MSG_COURSE_SUSPENDED);
    expect(studentMayOpenAssessment(access)).toBe(false);
  });

  it('blocks cancelled with no student open', () => {
    const access = evalAccess({ enrollmentStatus: 'cancelled' });
    expect(access.reason).toBe('course_cancelled');
    expect(access.message).toBe(MSG_COURSE_CANCELLED);
    expect(access.canMutate).toBe(false);
    expect(studentMayOpenAssessment(access)).toBe(false);
  });

  it('blocks completed from editable and open access', () => {
    const access = evalAccess({ enrollmentStatus: 'completed' });
    expect(access.reason).toBe('course_completed');
    expect(access.message).toBe(MSG_COURSE_COMPLETED);
    expect(access.canMutate).toBe(false);
    expect(studentMayOpenAssessment(access)).toBe(false);
  });

  it('fails closed when course_status missing', () => {
    const access = evalAccess({ enrollmentStatus: null });
    expect(access.reason).toBe('course_status_missing');
    expect(access.canMutate).toBe(false);
    expect(access.message).toBe(MSG_COURSE_NOT_IN_PROGRESS);
  });

  it('fails closed when course_start_date missing', () => {
    const access = evalAccess({ startDate: null });
    expect(access.reason).toBe('course_dates_missing');
    expect(access.canMutate).toBe(false);
  });

  it('fails closed when course_end_date missing', () => {
    const access = evalAccess({ endDate: null });
    expect(access.reason).toBe('course_dates_missing');
    expect(access.canMutate).toBe(false);
  });

  it('blocks when legacy enrolment link status is inactive even if in_progress', () => {
    const access = evalAccess({ linkStatus: 'inactive' });
    expect(access.reason).toBe('enrolment_inactive');
    expect(access.canMutate).toBe(false);
    expect(access.message).toBe(MSG_COURSE_NOT_IN_PROGRESS);
  });

  it('does not treat link status active as equivalent to in_progress', () => {
    const access = evalAccess({ linkStatus: 'active', enrollmentStatus: 'tentative' });
    expect(access.canMutate).toBe(false);
    expect(access.reason).toBe('course_tentative');
  });

  it('uses business date input (not browser local) for boundary decisions', () => {
    const melbourneToday = '2026-07-14';
    const access = evalAccess({
      startDate: '2026-07-14',
      endDate: '2026-07-14',
      todayMelbourneIso: melbourneToday,
    });
    expect(access.canMutate).toBe(true);
    const blocked = evalAccess({
      startDate: '2026-07-15',
      endDate: '2026-07-20',
      todayMelbourneIso: melbourneToday,
    });
    expect(blocked.reason).toBe('course_not_started');
  });
});

describe('canAccessCourseUnit / effective role', () => {
  it('recognises non-student roles', () => {
    expect(isNonStudentEffectiveRole('admin')).toBe(true);
    expect(isNonStudentEffectiveRole('superadmin')).toBe(true);
    expect(isNonStudentEffectiveRole('trainer')).toBe(true);
    expect(isNonStudentEffectiveRole('office')).toBe(true);
    expect(isNonStudentEffectiveRole('assessor')).toBe(true);
    expect(isNonStudentEffectiveRole('student')).toBe(false);
    expect(isNonStudentEffectiveRole(null)).toBe(false);
  });

  it('does not block admin/trainer/office for Tentative/Suspended/Cancelled/Completed', () => {
    for (const role of ['admin', 'superadmin', 'trainer', 'office', 'assessor']) {
      for (const status of ['tentative', 'suspended', 'cancelled', 'completed', null]) {
        const access = canAccessCourseUnit({
          effectiveRole: role,
          courseStatus: status,
          startDate: null,
          endDate: null,
        });
        expect(access.allowed).toBe(true);
        expect(access.blockedByCourseLifecycle).toBe(false);
        expect(access.canMutate).toBe(true);
      }
    }
  });

  it('blocks student for non-in-progress regardless of spoof attempt via courseStatus alone', () => {
    const access = canAccessCourseUnit({
      effectiveRole: 'student',
      courseStatus: 'tentative',
      linkStatus: 'active',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      todayMelbourneIso: TODAY,
    });
    expect(access.allowed).toBe(false);
    expect(access.blockedByCourseLifecycle).toBe(true);
    expect(access.message).toBe(MSG_COURSE_TENTATIVE);
  });

  it('allows student only for in_progress within dates', () => {
    const access = canAccessCourseUnit({
      effectiveRole: 'student',
      courseStatus: 'in_progress',
      linkStatus: 'active',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      todayMelbourneIso: TODAY,
    });
    expect(access.allowed).toBe(true);
    expect(access.blockedByCourseLifecycle).toBe(false);
  });

  it('treats unknown/omitted role as student (fail closed for lifecycle)', () => {
    const access = canAccessCourseUnit({
      effectiveRole: '',
      courseStatus: 'tentative',
      linkStatus: 'active',
      todayMelbourneIso: TODAY,
    });
    expect(access.allowed).toBe(false);
    expect(access.blockedByCourseLifecycle).toBe(true);
  });
});
