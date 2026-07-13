/**
 * Course lifecycle (enrollment_status on skyline_student_courses).
 * Kept separate from link status (`status` = active | inactive).
 */

export const COURSE_LIFECYCLE_STATUSES = [
  'tentative',
  'in_progress',
  'suspended',
  'cancelled',
  'completed',
] as const;

export type CourseLifecycleStatus = (typeof COURSE_LIFECYCLE_STATUSES)[number];

/** @deprecated Prefer CourseLifecycleStatus — alias for existing enrollment_status column. */
export type StudentCourseEnrollmentStatus = CourseLifecycleStatus;

export const COURSE_LIFECYCLE_LABELS: Record<CourseLifecycleStatus, string> = {
  tentative: 'Tentative',
  in_progress: 'In Progress',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

/** Tailwind classes for reusable status capsule (admin + student). */
export const COURSE_LIFECYCLE_BADGE_CLASS: Record<CourseLifecycleStatus, string> = {
  tentative: 'bg-gray-100 text-gray-700 border border-gray-200',
  in_progress: 'bg-amber-100 text-amber-900 border border-amber-200',
  suspended: 'bg-orange-100 text-orange-900 border border-orange-200',
  cancelled: 'bg-red-100 text-red-800 border border-red-200',
  completed: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
};

const ALLOWED_TRANSITIONS: Record<CourseLifecycleStatus, readonly CourseLifecycleStatus[]> = {
  tentative: ['in_progress', 'cancelled'],
  in_progress: ['suspended', 'completed', 'cancelled'],
  suspended: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function isCourseLifecycleStatus(value: unknown): value is CourseLifecycleStatus {
  return COURSE_LIFECYCLE_STATUSES.includes(String(value ?? '') as CourseLifecycleStatus);
}

export function normalizeCourseLifecycleStatus(raw: unknown): CourseLifecycleStatus | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (s === 'inprogress') return 'in_progress';
  if (isCourseLifecycleStatus(s)) return s;
  // Display labels
  const byLabel = Object.entries(COURSE_LIFECYCLE_LABELS).find(
    ([, label]) => label.toLowerCase() === String(raw ?? '').trim().toLowerCase(),
  );
  return byLabel ? (byLabel[0] as CourseLifecycleStatus) : null;
}

export function courseLifecycleLabel(status: CourseLifecycleStatus | string | null | undefined): string {
  const n = normalizeCourseLifecycleStatus(status) ?? 'in_progress';
  return COURSE_LIFECYCLE_LABELS[n];
}

export function courseLifecycleBadgeClass(status: CourseLifecycleStatus | string | null | undefined): string {
  const n = normalizeCourseLifecycleStatus(status) ?? 'in_progress';
  return COURSE_LIFECYCLE_BADGE_CLASS[n];
}

export function allowedNextCourseStatuses(
  current: CourseLifecycleStatus | string | null | undefined,
): CourseLifecycleStatus[] {
  const n = normalizeCourseLifecycleStatus(current);
  if (!n) return [...COURSE_LIFECYCLE_STATUSES];
  return [...ALLOWED_TRANSITIONS[n]];
}

export function canTransitionCourseStatus(
  from: CourseLifecycleStatus | string | null | undefined,
  to: CourseLifecycleStatus | string | null | undefined,
): boolean {
  const a = normalizeCourseLifecycleStatus(from);
  const b = normalizeCourseLifecycleStatus(to);
  if (!a || !b) return false;
  if (a === b) return true;
  return ALLOWED_TRANSITIONS[a].includes(b);
}

/** Inclusive overlap: existing.start <= proposed.end AND existing.end >= proposed.start */
export function courseDateRangesOverlap(
  aStart: string | null | undefined,
  aEnd: string | null | undefined,
  bStart: string | null | undefined,
  bEnd: string | null | undefined,
): boolean {
  const as = String(aStart ?? '').trim().slice(0, 10);
  const ae = String(aEnd ?? '').trim().slice(0, 10);
  const bs = String(bStart ?? '').trim().slice(0, 10);
  const be = String(bEnd ?? '').trim().slice(0, 10);
  if (!as || !ae || !bs || !be) return false;
  return as <= be && ae >= bs;
}

export function isValidIsoDate(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function validateCourseDateOrder(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  if (!start && !end) return null;
  if (start && !isValidIsoDate(start)) return 'Course start date is invalid.';
  if (end && !isValidIsoDate(end)) return 'Course end date is invalid.';
  if (start && end && start > end) {
    return 'Course end date cannot be before the course start date.';
  }
  return null;
}

/** Statuses that block new assessment activity for the student. */
export function courseBlocksNewAssessmentActivity(
  status: CourseLifecycleStatus | string | null | undefined,
): boolean {
  const n = normalizeCourseLifecycleStatus(status);
  return n === 'tentative' || n === 'suspended' || n === 'cancelled' || n === 'completed';
}

export function courseStudentAccessMessage(
  status: CourseLifecycleStatus | string | null | undefined,
): string | null {
  const n = normalizeCourseLifecycleStatus(status);
  if (n === 'tentative') {
    return 'This course has not started yet. Please contact administration.';
  }
  if (n === 'suspended') {
    return 'This course is currently suspended. Please contact administration.';
  }
  if (n === 'cancelled') {
    return 'This course has been cancelled. Please contact administration.';
  }
  if (n === 'completed') return 'This course has been completed.';
  return null;
}

export type CourseEnrollmentDraft = {
  course_id: number;
  start_date: string | null;
  end_date: string | null;
  enrollment_status: CourseLifecycleStatus;
};

export function defaultStatusForNewCourse(hasInProgress: boolean): CourseLifecycleStatus {
  return hasInProgress ? 'tentative' : 'in_progress';
}

export type OverlapConflict = {
  course_id: number;
  name?: string;
  qualification_code?: string | null;
  start_date: string | null;
  end_date: string | null;
  enrollment_status: CourseLifecycleStatus;
};

export function findCourseOverlapConflicts(
  proposed: { course_id: number; start_date: string | null; end_date: string | null },
  others: OverlapConflict[],
): OverlapConflict[] {
  return others.filter((o) => {
    if (o.course_id === proposed.course_id) return false;
    if (o.enrollment_status === 'cancelled') return false;
    return courseDateRangesOverlap(o.start_date, o.end_date, proposed.start_date, proposed.end_date);
  });
}

export function formatOverlapError(conflict: OverlapConflict): string {
  const code = conflict.qualification_code?.trim();
  const label = code ? `${code} — ${conflict.name ?? 'course'}` : conflict.name ?? 'another course';
  return `Course dates overlap with ${label}.`;
}

export const ERROR_ALREADY_IN_PROGRESS =
  'This student already has another course in progress. Complete, cancel or suspend the current course before starting this course.';

export const ERROR_MUST_CLEAR_IN_PROGRESS =
  'Complete, cancel or suspend the current course before starting this course.';
