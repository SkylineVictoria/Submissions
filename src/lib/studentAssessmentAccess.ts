/**
 * Course lifecycle access for assessments/units.
 * Lifecycle blocks apply only when effectiveRole is student.
 * Authorised non-student roles are never blocked by course_status alone.
 */
import { supabase } from './supabase';
import { melDateString } from '../utils/assessmentRowUi';
import {
  normalizeCourseLifecycleStatus,
  type CourseLifecycleStatus,
} from './courseLifecycle';

/** @deprecated Prefer COURSE_NOT_IN_PROGRESS_CODE */
export const COURSE_NOT_CURRENTLY_RUNNING_CODE = 'COURSE_NOT_IN_PROGRESS';
export const COURSE_NOT_IN_PROGRESS_CODE = 'COURSE_NOT_IN_PROGRESS';

export const MSG_COURSE_NOT_IN_PROGRESS =
  'This course is not currently in progress. Please contact administration.';
/** @deprecated Prefer MSG_COURSE_NOT_IN_PROGRESS */
export const MSG_COURSE_NOT_GOING_ON = MSG_COURSE_NOT_IN_PROGRESS;
export const MSG_COURSE_TENTATIVE =
  'This course has not started yet. Please contact administration.';
export const MSG_COURSE_SUSPENDED =
  'This course is currently suspended. Please contact administration.';
export const MSG_COURSE_CANCELLED =
  'This course has been cancelled. Please contact administration.';
export const MSG_COURSE_COMPLETED = 'This course has been completed.';

export type StudentAssessmentAccessReason =
  | 'allowed'
  | 'enrolment_inactive'
  | 'course_tentative'
  | 'course_suspended'
  | 'course_cancelled'
  | 'course_completed'
  | 'course_not_started'
  | 'course_ended'
  | 'course_dates_missing'
  | 'course_enrolment_missing'
  | 'course_status_missing'
  | 'enrolment_ambiguous'
  | 'existing_permission_denied';

export type StudentAssessmentAccessResult = {
  allowed: boolean;
  blockedByCourseLifecycle: boolean;
  /** Student may change answers / submit. */
  canMutate: boolean;
  /**
   * Student may open for read-only historical view.
   * Current business rule: students may only open when canMutate (In Progress + dates).
   */
  canOpenReadOnly: boolean;
  reason: StudentAssessmentAccessReason;
  message: string;
  code: typeof COURSE_NOT_IN_PROGRESS_CODE | null;
  courseStatus: CourseLifecycleStatus | null;
  courseStartDate: string | null;
  courseEndDate: string | null;
  courseId: number | null;
  studentId: number | null;
  formId: number | null;
};

/** Roles that must never be blocked by course lifecycle status alone. */
export function isNonStudentEffectiveRole(role: string | null | undefined): boolean {
  const r = String(role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!r || r === 'student') return false;
  return (
    r === 'trainer' ||
    r === 'office' ||
    r === 'admin' ||
    r === 'superadmin' ||
    r === 'super_admin' ||
    r === 'assessor' ||
    r === 'staff'
  );
}

function denied(
  reason: StudentAssessmentAccessReason,
  message: string,
  extra: Partial<StudentAssessmentAccessResult> = {},
): StudentAssessmentAccessResult {
  return {
    allowed: false,
    blockedByCourseLifecycle: true,
    canMutate: false,
    canOpenReadOnly: false,
    reason,
    message,
    code: COURSE_NOT_IN_PROGRESS_CODE,
    courseStatus: null,
    courseStartDate: null,
    courseEndDate: null,
    courseId: null,
    studentId: null,
    formId: null,
    ...extra,
  };
}

function allowedResult(
  extra: Partial<StudentAssessmentAccessResult> = {},
): StudentAssessmentAccessResult {
  return {
    allowed: true,
    blockedByCourseLifecycle: false,
    canMutate: true,
    canOpenReadOnly: true,
    reason: 'allowed',
    message: '',
    code: null,
    courseStatus: 'in_progress',
    courseStartDate: null,
    courseEndDate: null,
    courseId: null,
    studentId: null,
    formId: null,
    ...extra,
  };
}

function messageForStatus(status: CourseLifecycleStatus | null): string {
  if (status === 'tentative') return MSG_COURSE_TENTATIVE;
  if (status === 'suspended') return MSG_COURSE_SUSPENDED;
  if (status === 'cancelled') return MSG_COURSE_CANCELLED;
  if (status === 'completed') return MSG_COURSE_COMPLETED;
  return MSG_COURSE_NOT_IN_PROGRESS;
}

/**
 * Shared access rule: lifecycle blocks students only.
 * Non-student effective roles: lifecycleAllowed = true (existing permissions still apply elsewhere).
 */
export function canAccessCourseUnit(input: {
  effectiveRole: string | null | undefined;
  courseStatus?: string | null | undefined;
  linkStatus?: 'active' | 'inactive' | string | null | undefined;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
  todayMelbourneIso?: string;
  courseId?: number | null;
  studentId?: number | null;
  formId?: number | null;
}): StudentAssessmentAccessResult {
  if (isNonStudentEffectiveRole(input.effectiveRole)) {
    return allowedResult({
      courseStatus: normalizeCourseLifecycleStatus(input.courseStatus),
      courseStartDate: input.startDate ? String(input.startDate).trim().slice(0, 10) || null : null,
      courseEndDate: input.endDate ? String(input.endDate).trim().slice(0, 10) || null : null,
      courseId: input.courseId ?? null,
      studentId: input.studentId ?? null,
      formId: input.formId ?? null,
    });
  }

  // Student (or unknown → treat as student / fail closed via evaluator)
  return evaluateStudentCourseRunningAccess({
    linkStatus: input.linkStatus ?? 'active',
    enrollmentStatus: input.courseStatus,
    startDate: input.startDate,
    endDate: input.endDate,
    todayMelbourneIso: input.todayMelbourneIso ?? melDateString(),
    courseId: input.courseId,
    studentId: input.studentId,
    formId: input.formId,
  });
}

/** Pure evaluator for students — Melbourne ISO date (yyyy-MM-dd), not browser-local. */
export function evaluateStudentCourseRunningAccess(input: {
  linkStatus: 'active' | 'inactive' | string | null | undefined;
  enrollmentStatus: string | null | undefined;
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  todayMelbourneIso: string;
  courseId?: number | null;
  studentId?: number | null;
  formId?: number | null;
}): StudentAssessmentAccessResult {
  const base = {
    courseId: input.courseId ?? null,
    studentId: input.studentId ?? null,
    formId: input.formId ?? null,
    courseStartDate: input.startDate ? String(input.startDate).trim().slice(0, 10) || null : null,
    courseEndDate: input.endDate ? String(input.endDate).trim().slice(0, 10) || null : null,
  };

  const link = String(input.linkStatus ?? '').trim().toLowerCase();
  if (link && link !== 'active') {
    return denied('enrolment_inactive', MSG_COURSE_NOT_IN_PROGRESS, {
      ...base,
      courseStatus: normalizeCourseLifecycleStatus(input.enrollmentStatus),
    });
  }

  const status = normalizeCourseLifecycleStatus(input.enrollmentStatus);
  if (!status) {
    return denied('course_status_missing', MSG_COURSE_NOT_IN_PROGRESS, base);
  }

  if (status === 'tentative') {
    return denied('course_tentative', MSG_COURSE_TENTATIVE, { ...base, courseStatus: status });
  }
  if (status === 'suspended') {
    return denied('course_suspended', MSG_COURSE_SUSPENDED, { ...base, courseStatus: status });
  }
  if (status === 'cancelled') {
    return denied('course_cancelled', MSG_COURSE_CANCELLED, { ...base, courseStatus: status });
  }
  if (status === 'completed') {
    return denied('course_completed', MSG_COURSE_COMPLETED, { ...base, courseStatus: status });
  }

  // in_progress — also require inclusive Melbourne course date window (existing approved rule)
  const start = base.courseStartDate;
  const end = base.courseEndDate;
  if (!start || !end) {
    return denied('course_dates_missing', MSG_COURSE_NOT_IN_PROGRESS, { ...base, courseStatus: status });
  }

  const today = String(input.todayMelbourneIso ?? '').trim().slice(0, 10);
  if (!today) {
    return denied('course_dates_missing', MSG_COURSE_NOT_IN_PROGRESS, { ...base, courseStatus: status });
  }
  if (today < start) {
    return denied('course_not_started', MSG_COURSE_NOT_IN_PROGRESS, { ...base, courseStatus: status });
  }
  if (today > end) {
    return denied('course_ended', MSG_COURSE_NOT_IN_PROGRESS, { ...base, courseStatus: status });
  }

  return allowedResult({
    ...base,
    courseStatus: status,
  });
}

type EnrolmentRow = {
  course_id: number;
  status: string | null;
  enrollment_status: string | null;
  start_date: string | null;
  end_date: string | null;
};

export async function fetchFormCourseIds(formId: number): Promise<number[]> {
  const fid = Number(formId);
  if (!Number.isFinite(fid) || fid <= 0) return [];
  const { data, error } = await supabase
    .from('skyline_course_forms')
    .select('course_id')
    .eq('form_id', fid);
  if (error) {
    console.error('fetchFormCourseIds error', error);
    return [];
  }
  return [
    ...new Set(
      ((data as Array<{ course_id: number }> | null) ?? [])
        .map((r) => Number(r.course_id))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
}

async function fetchStudentCourseEnrolments(
  studentId: number,
  courseIds: number[],
): Promise<EnrolmentRow[]> {
  if (courseIds.length === 0) return [];
  const { data, error } = await supabase
    .from('skyline_student_courses')
    .select('course_id, status, enrollment_status, start_date, end_date')
    .eq('student_id', studentId)
    .in('course_id', courseIds);
  if (error) {
    console.error('fetchStudentCourseEnrolments error', error);
    return [];
  }
  return (data as EnrolmentRow[] | null) ?? [];
}

/**
 * Resolve enrolment for an assessment instance and evaluate student access.
 * Prefers the single matching In Progress enrolment; denies when ambiguous.
 */
export async function getStudentAssessmentAccess(params: {
  instanceId: number;
  studentId?: number | null;
  formId?: number | null;
  /** Melbourne business date override (tests). */
  todayMelbourneIso?: string;
  /** When set to a non-student role, lifecycle does not block. */
  effectiveRole?: string | null;
}): Promise<StudentAssessmentAccessResult> {
  if (isNonStudentEffectiveRole(params.effectiveRole)) {
    return allowedResult();
  }

  const instanceId = Number(params.instanceId);
  if (!Number.isFinite(instanceId) || instanceId <= 0) {
    return denied('course_enrolment_missing', MSG_COURSE_NOT_IN_PROGRESS);
  }

  let studentId = params.studentId != null ? Number(params.studentId) : null;
  let formId = params.formId != null ? Number(params.formId) : null;

  if (!Number.isFinite(studentId as number) || !Number.isFinite(formId as number)) {
    const { data: inst, error } = await supabase
      .from('skyline_form_instances')
      .select('student_id, form_id')
      .eq('id', instanceId)
      .maybeSingle();
    if (error || !inst) {
      console.error('getStudentAssessmentAccess instance error', error);
      return denied('course_enrolment_missing', MSG_COURSE_NOT_IN_PROGRESS);
    }
    studentId = Number((inst as { student_id?: number | null }).student_id ?? 0) || null;
    formId = Number((inst as { form_id?: number | null }).form_id ?? 0) || null;
  }

  if (!studentId || !formId) {
    return denied('course_enrolment_missing', MSG_COURSE_NOT_IN_PROGRESS, {
      studentId,
      formId,
    });
  }

  const courseIds = await fetchFormCourseIds(formId);
  if (courseIds.length === 0) {
    return denied('course_enrolment_missing', MSG_COURSE_NOT_IN_PROGRESS, {
      studentId,
      formId,
    });
  }

  const enrolments = await fetchStudentCourseEnrolments(studentId, courseIds);
  if (enrolments.length === 0) {
    return denied('course_enrolment_missing', MSG_COURSE_NOT_IN_PROGRESS, {
      studentId,
      formId,
    });
  }

  const active = enrolments.filter((e) => String(e.status ?? '').trim() === 'active');
  if (active.length === 0) {
    const row = enrolments[0];
    return evaluateStudentCourseRunningAccess({
      linkStatus: row.status,
      enrollmentStatus: row.enrollment_status,
      startDate: row.start_date,
      endDate: row.end_date,
      todayMelbourneIso: params.todayMelbourneIso ?? melDateString(),
      courseId: row.course_id,
      studentId,
      formId,
    });
  }

  const inProgress = active.filter(
    (e) => normalizeCourseLifecycleStatus(e.enrollment_status) === 'in_progress',
  );
  if (inProgress.length > 1) {
    console.warn('getStudentAssessmentAccess ambiguous in_progress enrolments', {
      studentId,
      formId,
      instanceId,
      courseIds: inProgress.map((e) => e.course_id),
    });
    return denied('enrolment_ambiguous', MSG_COURSE_NOT_IN_PROGRESS, {
      studentId,
      formId,
    });
  }

  const chosen = inProgress[0] ?? active[0];
  if (active.length > 1 && !inProgress[0]) {
    console.warn('getStudentAssessmentAccess multiple non-running enrolments', {
      studentId,
      formId,
      instanceId,
      courseIds: active.map((e) => e.course_id),
    });
  }

  return evaluateStudentCourseRunningAccess({
    linkStatus: chosen.status,
    enrollmentStatus: chosen.enrollment_status,
    startDate: chosen.start_date,
    endDate: chosen.end_date,
    todayMelbourneIso: params.todayMelbourneIso ?? melDateString(),
    courseId: chosen.course_id,
    studentId,
    formId,
  });
}

/** Student may open only when the course is currently running (mutate allowed). */
export function studentMayOpenAssessment(access: StudentAssessmentAccessResult): boolean {
  return access.canMutate;
}

export function studentMayMutateAssessment(access: StudentAssessmentAccessResult): boolean {
  return access.canMutate;
}

export async function canStudentAccessAssessment(
  params: Parameters<typeof getStudentAssessmentAccess>[0],
): Promise<StudentAssessmentAccessResult> {
  return getStudentAssessmentAccess(params);
}

export class StudentCourseAccessError extends Error {
  readonly code = COURSE_NOT_IN_PROGRESS_CODE;
  readonly access: StudentAssessmentAccessResult;

  constructor(access: StudentAssessmentAccessResult) {
    super(access.message || messageForStatus(access.courseStatus));
    this.name = 'StudentCourseAccessError';
    this.access = access;
  }
}

/**
 * Enforce mutation gate for student-owned draft instances.
 * Authorised non-student actors (trainer/office/admin/…) skip the lifecycle gate.
 */
export async function assertStudentInstanceMutationAllowed(
  instanceId: number,
  options?: { actorRole?: 'student' | 'trainer' | 'office' | string | null; source?: string },
): Promise<void> {
  const role = String(options?.actorRole ?? '').trim();
  if (isNonStudentEffectiveRole(role)) return;
  const source = String(options?.source ?? '');
  if (source === 'adminQuickEdit') return;

  const { data: inst } = await supabase
    .from('skyline_form_instances')
    .select('student_id, form_id, status, role_context, workflow_status')
    .eq('id', instanceId)
    .maybeSingle();
  if (!inst) return;

  const studentId = (inst as { student_id?: number | null }).student_id;
  if (studentId == null) return;

  const status = String((inst as { status?: string | null }).status ?? '').trim();
  const roleCtx = String((inst as { role_context?: string | null }).role_context ?? '').trim();
  const wf = String((inst as { workflow_status?: string | null }).workflow_status ?? '').trim();

  // Only gate while the assessment is still with the student (draft).
  const withStudent =
    status === 'draft' &&
    (roleCtx === 'student' || roleCtx === '' || wf === 'draft' || wf === '');
  if (!withStudent) return;

  // Explicit non-student already returned; any other non-empty non-student role already handled.
  if (role && role !== 'student') return;

  // role omitted or 'student' on a student draft → apply lifecycle (fail closed).
  const access = await getStudentAssessmentAccess({
    instanceId,
    studentId: Number(studentId),
    formId: Number((inst as { form_id?: number }).form_id),
    effectiveRole: role || 'student',
  });
  if (!studentMayMutateAssessment(access)) {
    console.warn('Student assessment mutation blocked', {
      instanceId,
      studentId,
      formId: access.formId,
      courseId: access.courseId,
      courseStatus: access.courseStatus,
      courseStartDate: access.courseStartDate,
      courseEndDate: access.courseEndDate,
      reason: access.reason,
      source: options?.source ?? null,
      actorRole: role || 'student',
    });
    throw new StudentCourseAccessError(access);
  }
}
