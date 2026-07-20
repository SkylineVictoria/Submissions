/**
 * Resolve whether an import course row updates an existing enrolment vs creates a new one.
 * Same-course timetable imports must not fail the one-In-Progress rule against themselves.
 */
import {
  canTransitionCourseStatus,
  courseLifecycleLabel,
  defaultStatusForNewCourseEnrollment,
  findCourseOverlapConflicts,
  formatOverlapError,
  normalizeCourseLifecycleStatus,
  type CourseLifecycleStatus,
  type OverlapConflict,
} from './courseLifecycle';

export type ExistingEnrollmentLite = {
  course_id: number;
  enrollment_status: CourseLifecycleStatus;
  start_date: string | null;
  end_date: string | null;
  name?: string;
  qualification_code?: string | null;
};

export type ImportCourseAction =
  | 'update_existing_timetable'
  | 'add_units_existing_course'
  | 'create_new_in_progress'
  | 'create_new_tentative'
  | 'skip_no_changes'
  | 'error';

export type ImportCourseDraftResolution = {
  course_id: number;
  isExisting: boolean;
  /** null = do not change status (preserve existing / omit on upsert). */
  enrollment_status: CourseLifecycleStatus | null;
  explicitStatus: boolean;
  file_start_date: string | null;
  file_end_date: string | null;
  action: ImportCourseAction;
  actionLabel: string;
  proposedStatusLabel: string;
  error?: string;
};

export function otherInProgressEnrollments(
  existing: ExistingEnrollmentLite[],
  excludeCourseId: number
): ExistingEnrollmentLite[] {
  return existing.filter(
    (e) => e.course_id !== excludeCourseId && e.enrollment_status === 'in_progress'
  );
}

export function hasOtherInProgress(
  existing: ExistingEnrollmentLite[],
  excludeCourseId: number
): boolean {
  return otherInProgressEnrollments(existing, excludeCourseId).length > 0;
}

/** True when the student has/will have exactly one non-cancelled course (existing + this import). */
export function isSingleCourseImportStudent(
  existingEnrollments: ExistingEnrollmentLite[],
  importCourseIds: number[]
): boolean {
  const ids = new Set<number>();
  for (const e of existingEnrollments) {
    if (e.enrollment_status === 'cancelled') continue;
    ids.add(e.course_id);
  }
  for (const id of importCourseIds) {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return ids.size === 1;
}

function canDefaultSingleCourseInProgress(input: {
  singleCourseStudent?: boolean;
  fileStartDate: string | null;
  fileEndDate: string | null;
  otherInProgress: boolean;
}): boolean {
  return Boolean(
    input.singleCourseStudent &&
      input.fileStartDate &&
      input.fileEndDate &&
      !input.otherInProgress
  );
}

export function formatAlreadyInProgressError(
  studentLabel: string,
  blocking: ExistingEnrollmentLite,
  importedLabel?: string
): string {
  const blockCode = blocking.qualification_code?.trim() || blocking.name || `course ${blocking.course_id}`;
  const imported = importedLabel ? ` The imported course (${importedLabel})` : ' The imported course';
  return (
    `Student ${studentLabel} already has ${blockCode} In Progress.` +
    `${imported} cannot also be In Progress. Import it as Tentative or close/suspend the current course.`
  );
}

export function formatImportOverlapError(
  courseLabel: string,
  proposedStart: string | null,
  proposedEnd: string | null,
  conflict: OverlapConflict
): string {
  const conflictCode =
    conflict.qualification_code?.trim() || conflict.name || `course ${conflict.course_id}`;
  const a = proposedStart && proposedEnd ? `${proposedStart}–${proposedEnd}` : 'unknown period';
  const b =
    conflict.start_date && conflict.end_date
      ? `${conflict.start_date}–${conflict.end_date}`
      : 'unknown period';
  return (
    `Cannot update ${courseLabel} timetable. The resulting course period ${a} overlaps with ${conflictCode} ${b}.`
  );
}

/**
 * Resolve lifecycle/status for one imported course against the student's existing enrolments.
 * Call after student + course are resolved. Does not mutate DB.
 */
export function resolveImportCourseDraft(input: {
  courseId: number;
  existingEnrollments: ExistingEnrollmentLite[];
  fileStartDate: string | null;
  fileEndDate: string | null;
  statusRaw?: string | null;
  studentLabel: string;
  courseLabel?: string;
  /** When assigning defaults among multiple NEW courses in one file, whether another (new or existing) is already In Progress. */
  treatOtherInProgress?: boolean;
  /** Student has only one course (existing + import) — default that course to In Progress when dates exist. */
  singleCourseStudent?: boolean;
}): ImportCourseDraftResolution {
  const courseId = Number(input.courseId);
  const existing = input.existingEnrollments.find((e) => e.course_id === courseId) ?? null;
  const statusRaw = String(input.statusRaw ?? '').trim();
  const normalized = statusRaw ? normalizeCourseLifecycleStatus(statusRaw) : null;
  if (statusRaw && !normalized) {
    return {
      course_id: courseId,
      isExisting: Boolean(existing),
      enrollment_status: null,
      explicitStatus: true,
      file_start_date: input.fileStartDate,
      file_end_date: input.fileEndDate,
      action: 'error',
      actionLabel: 'Error',
      proposedStatusLabel: `Invalid: ${statusRaw}`,
      error: `Invalid Course Status "${statusRaw}" for student ${input.studentLabel} course ${input.courseLabel ?? courseId}.`,
    };
  }

  const otherIP =
    input.treatOtherInProgress ?? hasOtherInProgress(input.existingEnrollments, courseId);
  const courseLabel = input.courseLabel ?? `course ${courseId}`;
  const defaultSingleActive = canDefaultSingleCourseInProgress({
    singleCourseStudent: input.singleCourseStudent,
    fileStartDate: input.fileStartDate,
    fileEndDate: input.fileEndDate,
    otherInProgress: otherIP,
  });

  // ---- Existing same-course timetable update ----
  if (existing) {
    if (!normalized) {
      if (defaultSingleActive && existing.enrollment_status === 'tentative') {
        return {
          course_id: courseId,
          isExisting: true,
          enrollment_status: 'in_progress',
          explicitStatus: true,
          file_start_date: input.fileStartDate,
          file_end_date: input.fileEndDate,
          action: 'update_existing_timetable',
          actionLabel: 'Update Existing Course Timetable',
          proposedStatusLabel: 'In Progress',
        };
      }
      return {
        course_id: courseId,
        isExisting: true,
        enrollment_status: null,
        explicitStatus: false,
        file_start_date: input.fileStartDate,
        file_end_date: input.fileEndDate,
        action: 'update_existing_timetable',
        actionLabel: 'Update Existing Course Timetable',
        proposedStatusLabel: `Preserve ${courseLifecycleLabel(existing.enrollment_status)}`,
      };
    }
    if (normalized === existing.enrollment_status) {
      return {
        course_id: courseId,
        isExisting: true,
        enrollment_status: null,
        explicitStatus: true,
        file_start_date: input.fileStartDate,
        file_end_date: input.fileEndDate,
        action: 'update_existing_timetable',
        actionLabel: 'Update Existing Course Timetable',
        proposedStatusLabel: courseLifecycleLabel(normalized),
      };
    }
    if (!canTransitionCourseStatus(existing.enrollment_status, normalized)) {
      return {
        course_id: courseId,
        isExisting: true,
        enrollment_status: null,
        explicitStatus: true,
        file_start_date: input.fileStartDate,
        file_end_date: input.fileEndDate,
        action: 'error',
        actionLabel: 'Error',
        proposedStatusLabel: courseLifecycleLabel(normalized),
        error: `Cannot change course status from ${courseLifecycleLabel(existing.enrollment_status)} to ${courseLifecycleLabel(normalized)} for student ${input.studentLabel} (${courseLabel}).`,
      };
    }
    if (normalized === 'in_progress') {
      if (!input.fileStartDate || !input.fileEndDate) {
        // Dates may still be derived after unit upsert from full DB set — allow if existing has dates
        if (!existing.start_date || !existing.end_date) {
          return {
            course_id: courseId,
            isExisting: true,
            enrollment_status: null,
            explicitStatus: true,
            file_start_date: input.fileStartDate,
            file_end_date: input.fileEndDate,
            action: 'error',
            actionLabel: 'Error',
            proposedStatusLabel: 'In Progress',
            error: `Course Status is In Progress but course dates could not be derived for student ${input.studentLabel} (${courseLabel}).`,
          };
        }
      }
      if (otherIP) {
        const blocking = otherInProgressEnrollments(input.existingEnrollments, courseId)[0];
        return {
          course_id: courseId,
          isExisting: true,
          enrollment_status: null,
          explicitStatus: true,
          file_start_date: input.fileStartDate,
          file_end_date: input.fileEndDate,
          action: 'error',
          actionLabel: 'Error',
          proposedStatusLabel: 'In Progress',
          error: formatAlreadyInProgressError(input.studentLabel, blocking, courseLabel),
        };
      }
    }
    return {
      course_id: courseId,
      isExisting: true,
      enrollment_status: normalized,
      explicitStatus: true,
      file_start_date: input.fileStartDate,
      file_end_date: input.fileEndDate,
      action: 'update_existing_timetable',
      actionLabel: 'Update Existing Course Timetable',
      proposedStatusLabel: courseLifecycleLabel(normalized),
    };
  }

  // ---- Genuinely new course enrolment ----
  if (normalized) {
    if (normalized === 'in_progress') {
      if (!input.fileStartDate || !input.fileEndDate) {
        return {
          course_id: courseId,
          isExisting: false,
          enrollment_status: null,
          explicitStatus: true,
          file_start_date: input.fileStartDate,
          file_end_date: input.fileEndDate,
          action: 'error',
          actionLabel: 'Error',
          proposedStatusLabel: 'In Progress',
          error: `Course Status is In Progress but course dates could not be derived from Activity Start/End for student ${input.studentLabel} (${courseLabel}).`,
        };
      }
      if (otherIP) {
        const blocking = otherInProgressEnrollments(input.existingEnrollments, courseId)[0] ?? {
          course_id: 0,
          enrollment_status: 'in_progress' as const,
          start_date: null,
          end_date: null,
          name: 'another course',
        };
        return {
          course_id: courseId,
          isExisting: false,
          enrollment_status: null,
          explicitStatus: true,
          file_start_date: input.fileStartDate,
          file_end_date: input.fileEndDate,
          action: 'error',
          actionLabel: 'Error',
          proposedStatusLabel: 'In Progress',
          error: formatAlreadyInProgressError(input.studentLabel, blocking, courseLabel),
        };
      }
      return {
        course_id: courseId,
        isExisting: false,
        enrollment_status: 'in_progress',
        explicitStatus: true,
        file_start_date: input.fileStartDate,
        file_end_date: input.fileEndDate,
        action: 'create_new_in_progress',
        actionLabel: 'Create New Course — In Progress',
        proposedStatusLabel: 'In Progress',
      };
    }
    return {
      course_id: courseId,
      isExisting: false,
      enrollment_status: normalized,
      explicitStatus: true,
      file_start_date: input.fileStartDate,
      file_end_date: input.fileEndDate,
      action: normalized === 'tentative' ? 'create_new_tentative' : 'create_new_tentative',
      actionLabel:
        normalized === 'tentative'
          ? 'Create New Course — Tentative'
          : `Create New Course — ${courseLifecycleLabel(normalized)}`,
      proposedStatusLabel: courseLifecycleLabel(normalized),
    };
  }

  const status = defaultSingleActive
    ? 'in_progress'
    : defaultStatusForNewCourseEnrollment({
        hasInProgress: otherIP,
        startDate: input.fileStartDate,
        endDate: input.fileEndDate,
      });
  return {
    course_id: courseId,
    isExisting: false,
    enrollment_status: status,
    explicitStatus: defaultSingleActive,
    file_start_date: input.fileStartDate,
    file_end_date: input.fileEndDate,
    action: status === 'in_progress' ? 'create_new_in_progress' : 'create_new_tentative',
    actionLabel:
      status === 'in_progress' ? 'Create New Course — In Progress' : 'Create New Course — Tentative',
    proposedStatusLabel: courseLifecycleLabel(status),
  };
}

/**
 * Resolve all course drafts for one student, assigning In Progress among NEW courses chronologically
 * while never treating an existing same-course In Progress enrolment as a conflict with itself.
 */
export function resolveImportCourseDraftsForStudent(input: {
  studentLabel: string;
  existingEnrollments: ExistingEnrollmentLite[];
  courses: Array<{
    courseId: number;
    courseLabel?: string;
    fileStartDate: string | null;
    fileEndDate: string | null;
    statusRaw?: string | null;
  }>;
}): ImportCourseDraftResolution[] {
  const results: ImportCourseDraftResolution[] = [];
  const importCourseIds = input.courses.map((c) => c.courseId);
  const singleCourseStudent = isSingleCourseImportStudent(input.existingEnrollments, importCourseIds);
  // Track In Progress after applying existing + already-resolved drafts in this file
  const inProgressCourseIds = new Set(
    input.existingEnrollments
      .filter((e) => e.enrollment_status === 'in_progress')
      .map((e) => e.course_id)
  );

  const chronological = [...input.courses].sort((a, b) => {
    const as = a.fileStartDate ?? '9999-99-99';
    const bs = b.fileStartDate ?? '9999-99-99';
    return as < bs ? -1 : as > bs ? 1 : a.courseId - b.courseId;
  });

  for (const c of chronological) {
    const otherIP = [...inProgressCourseIds].some((id) => id !== c.courseId);
    const resolved = resolveImportCourseDraft({
      courseId: c.courseId,
      existingEnrollments: input.existingEnrollments,
      fileStartDate: c.fileStartDate,
      fileEndDate: c.fileEndDate,
      statusRaw: c.statusRaw,
      studentLabel: input.studentLabel,
      courseLabel: c.courseLabel,
      treatOtherInProgress: otherIP,
      singleCourseStudent,
    });
    results.push(resolved);
    if (resolved.error) continue;
    if (resolved.isExisting) {
      const existing = input.existingEnrollments.find((e) => e.course_id === c.courseId);
      const finalStatus = resolved.enrollment_status ?? existing?.enrollment_status;
      if (finalStatus === 'in_progress') inProgressCourseIds.add(c.courseId);
      else inProgressCourseIds.delete(c.courseId);
    } else if (resolved.enrollment_status === 'in_progress') {
      inProgressCourseIds.add(c.courseId);
    }
  }

  // Preserve original course order from input.courses
  const byId = new Map(results.map((r) => [r.course_id, r]));
  return input.courses.map((c) => byId.get(c.courseId)!).filter(Boolean);
}

/** Overlap check excluding the enrolment being updated (by course_id). */
export function findImportOverlapConflictsExcludingSelf(
  proposed: { course_id: number; start_date: string | null; end_date: string | null },
  others: OverlapConflict[]
): OverlapConflict[] {
  return findCourseOverlapConflicts(proposed, others);
}

export { formatOverlapError };
