/** Trim-only normalization for import Student ID / Contact ID (preserve leading zeroes in string form). */
export function normalizeImportStudentId(raw: string | undefined | null): string {
  return String(raw ?? '').trim();
}

/** Merge course ids without removing existing assignments. */
export function mergeCourseIds(existing: number[], incoming: number[]): number[] {
  const set = new Set<number>();
  for (const n of [...existing, ...incoming]) {
    const id = Number(n);
    if (Number.isFinite(id) && id > 0) set.add(id);
  }
  return [...set];
}

/** Split student ids into those enrolled in batchCourseId vs invalid. */
export function partitionStudentsByBatchCourse(
  studentIds: number[],
  enrolledCourseIdsByStudent: Map<number, number[]>,
  batchCourseId: number
): { valid: number[]; invalid: number[] } {
  const cid = Number(batchCourseId);
  if (!Number.isFinite(cid) || cid <= 0) {
    return { valid: [], invalid: studentIds.filter((n) => Number.isFinite(n) && n > 0) };
  }
  const valid: number[] = [];
  const invalid: number[] = [];
  for (const sid of studentIds) {
    const id = Number(sid);
    if (!Number.isFinite(id) || id <= 0) continue;
    const courses = enrolledCourseIdsByStudent.get(id) ?? [];
    if (courses.includes(cid)) valid.push(id);
    else invalid.push(id);
  }
  return { valid, invalid };
}

export const BATCH_STUDENT_COURSE_MISMATCH =
  'Student cannot be added to this batch because the student is not enrolled in the batch course.';
