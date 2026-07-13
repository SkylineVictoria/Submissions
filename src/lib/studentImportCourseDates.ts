/**
 * Derive student-course enrolment dates from unit/activity instance dates during import.
 * Course start = MIN(instance start_date); course end = MAX(instance end_date).
 */
import { supabase } from './supabase';
import { isValidIsoDate } from './courseLifecycle';

export type ActivityDatePair = {
  activity_start_date?: string | null;
  activity_end_date?: string | null;
};

export type DerivedCourseDates = {
  courseStartDate: string | null;
  courseEndDate: string | null;
  earliestActivityStart: string | null;
  latestActivityEnd: string | null;
  unitRowCount: number;
  validStartCount: number;
  validEndCount: number;
};

/** Chronological min of ISO date strings (yyyy-MM-dd). */
export function minIsoDate(dates: Array<string | null | undefined>): string | null {
  const valid = dates
    .map((d) => String(d ?? '').trim().slice(0, 10))
    .filter((d) => isValidIsoDate(d));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a <= b ? a : b));
}

/** Chronological max of ISO date strings (yyyy-MM-dd). */
export function maxIsoDate(dates: Array<string | null | undefined>): string | null {
  const valid = dates
    .map((d) => String(d ?? '').trim().slice(0, 10))
    .filter((d) => isValidIsoDate(d));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a >= b ? a : b));
}

/**
 * Derive proposed course dates from imported unit/activity rows (file only).
 * Uses chronological MIN/MAX — not spreadsheet row order.
 */
export function deriveCourseDatesFromActivityRows(rows: ActivityDatePair[]): DerivedCourseDates {
  const starts = rows.map((r) => r.activity_start_date ?? null);
  const ends = rows.map((r) => r.activity_end_date ?? null);
  const earliest = minIsoDate(starts);
  const latest = maxIsoDate(ends);
  return {
    courseStartDate: earliest,
    courseEndDate: latest,
    earliestActivityStart: earliest,
    latestActivityEnd: latest,
    unitRowCount: rows.length,
    validStartCount: starts.filter((d) => isValidIsoDate(String(d ?? '').trim().slice(0, 10))).length,
    validEndCount: ends.filter((d) => isValidIsoDate(String(d ?? '').trim().slice(0, 10))).length,
  };
}

/** Row-level activity date validation. Returns an error message or null. */
export function validateActivityDatePair(
  start: string | null | undefined,
  end: string | null | undefined,
  rowLabel?: string,
): string | null {
  const s = String(start ?? '').trim().slice(0, 10);
  const e = String(end ?? '').trim().slice(0, 10);
  const prefix = rowLabel ? `${rowLabel}: ` : '';
  if (s && !isValidIsoDate(s)) return `${prefix}Invalid Activity Start Date.`;
  if (e && !isValidIsoDate(e)) return `${prefix}Invalid Activity End Date.`;
  if (s && !e) return `${prefix}Activity End Date is required when Activity Start Date is provided.`;
  if (e && !s) return `${prefix}Activity Start Date is required when Activity End Date is provided.`;
  if (s && e && e < s) return `${prefix}Activity End Date cannot be before Activity Start Date.`;
  return null;
}

export type MappedInstanceDateRange = {
  startDate: string | null;
  endDate: string | null;
  instanceCount: number;
  ambiguous: boolean;
  ambiguousFormIds: number[];
};

/**
 * Recalculate course enrolment dates from all mapped assessment instances in the DB.
 * Uses skyline_course_forms → form instances for the student.
 * Fails closed (ambiguous=true) when a form is linked to multiple of the student's courses.
 */
export async function computeCourseDateRangeFromMappedInstances(
  studentId: number,
  courseId: number,
): Promise<MappedInstanceDateRange> {
  const sid = Number(studentId);
  const cid = Number(courseId);
  if (!Number.isFinite(sid) || sid <= 0 || !Number.isFinite(cid) || cid <= 0) {
    return { startDate: null, endDate: null, instanceCount: 0, ambiguous: false, ambiguousFormIds: [] };
  }

  const { data: courseLinks, error: linkErr } = await supabase
    .from('skyline_course_forms')
    .select('form_id')
    .eq('course_id', cid);
  if (linkErr) {
    console.error('computeCourseDateRangeFromMappedInstances links error', linkErr);
    return { startDate: null, endDate: null, instanceCount: 0, ambiguous: true, ambiguousFormIds: [] };
  }
  const formIds = [
    ...new Set(
      ((courseLinks as Array<{ form_id: number }> | null) ?? [])
        .map((r) => Number(r.form_id))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
  if (formIds.length === 0) {
    return { startDate: null, endDate: null, instanceCount: 0, ambiguous: false, ambiguousFormIds: [] };
  }

  const { data: studentCourses } = await supabase
    .from('skyline_student_courses')
    .select('course_id')
    .eq('student_id', sid)
    .eq('status', 'active');
  const enrolledCourseIds = new Set(
    ((studentCourses as Array<{ course_id: number }> | null) ?? [])
      .map((r) => Number(r.course_id))
      .filter((n) => Number.isFinite(n) && n > 0),
  );
  enrolledCourseIds.add(cid);

  const { data: allFormLinks } = await supabase
    .from('skyline_course_forms')
    .select('form_id, course_id')
    .in('form_id', formIds);

  const ambiguousFormIds: number[] = [];
  const safeFormIds: number[] = [];
  for (const fid of formIds) {
    const linkedCourses = [
      ...new Set(
        ((allFormLinks as Array<{ form_id: number; course_id: number }> | null) ?? [])
          .filter((r) => Number(r.form_id) === fid)
          .map((r) => Number(r.course_id))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
    const overlapOther = linkedCourses.filter((c) => c !== cid && enrolledCourseIds.has(c));
    if (overlapOther.length > 0) {
      ambiguousFormIds.push(fid);
    } else {
      safeFormIds.push(fid);
    }
  }

  if (ambiguousFormIds.length > 0 && safeFormIds.length === 0) {
    return {
      startDate: null,
      endDate: null,
      instanceCount: 0,
      ambiguous: true,
      ambiguousFormIds,
    };
  }

  if (safeFormIds.length === 0) {
    return { startDate: null, endDate: null, instanceCount: 0, ambiguous: false, ambiguousFormIds };
  }

  const { data: instances, error: instErr } = await supabase
    .from('skyline_form_instances')
    .select('id, form_id, start_date, end_date')
    .eq('student_id', sid)
    .in('form_id', safeFormIds);
  if (instErr) {
    console.error('computeCourseDateRangeFromMappedInstances instances error', instErr);
    return { startDate: null, endDate: null, instanceCount: 0, ambiguous: true, ambiguousFormIds };
  }

  const rows = (instances as Array<{
    id: number;
    form_id: number;
    start_date: string | null;
    end_date: string | null;
  }> | null) ?? [];

  return {
    startDate: minIsoDate(rows.map((r) => r.start_date)),
    endDate: maxIsoDate(rows.map((r) => r.end_date)),
    instanceCount: rows.length,
    ambiguous: ambiguousFormIds.length > 0,
    ambiguousFormIds,
  };
}

/**
 * Merge recalculated DB range with existing stored dates when import adds no valid dates.
 * Prefer full DB range when present; never invent dates.
 */
export function resolveCourseDatesAfterImport(input: {
  recomputedStart: string | null;
  recomputedEnd: string | null;
  existingStart: string | null | undefined;
  existingEnd: string | null | undefined;
}): { startDate: string | null; endDate: string | null } {
  const hasRecomputed = Boolean(input.recomputedStart || input.recomputedEnd);
  if (hasRecomputed) {
    return {
      startDate: input.recomputedStart,
      endDate: input.recomputedEnd,
    };
  }
  return {
    startDate: input.existingStart ? String(input.existingStart).trim().slice(0, 10) || null : null,
    endDate: input.existingEnd ? String(input.existingEnd).trim().slice(0, 10) || null : null,
  };
}
