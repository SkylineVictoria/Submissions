import type { AttemptResult } from '../utils/assessmentRowUi';
import { getAssessmentOutcomeDisplay } from '../utils/assessmentRowUi';
import type { StudentCourseEnrollment } from '../lib/formEngine';
import type { SubmittedInstanceRow } from '../lib/formEngine';

export function defaultIntakeLabel(course: Pick<StudentCourseEnrollment, 'name' | 'qualification_code' | 'enrolled_at'>): string {
  const year = course.enrolled_at?.match(/^(\d{4})/)?.[1];
  const code = course.qualification_code?.trim();
  const base = code ? `${code} — ${course.name}` : course.name;
  return year ? `${base} ${year}` : base;
}

export function enrollmentStatusLabel(status: StudentCourseEnrollment['enrollment_status']): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'suspended':
      return 'Suspended';
    default:
      return 'In Progress';
  }
}

export function resolveAssessmentCourseId(
  row: SubmittedInstanceRow,
  enrolledCourseIds: number[]
): number | null {
  const linked = row.form_course_ids ?? [];
  const enrolledMatches = linked.filter((id) => enrolledCourseIds.includes(id));
  if (enrolledMatches.length > 0) return enrolledMatches[0];
  if (linked.length > 0) return linked[0];
  return null;
}

export function groupAssessmentsByCourse(
  assessments: SubmittedInstanceRow[],
  enrollments: StudentCourseEnrollment[]
): Map<number | 'unassigned', SubmittedInstanceRow[]> {
  const enrolledIds = enrollments.map((e) => e.course_id);
  const map = new Map<number | 'unassigned', SubmittedInstanceRow[]>();
  for (const e of enrollments) map.set(e.course_id, []);
  map.set('unassigned', []);

  for (const row of assessments) {
    const cid = resolveAssessmentCourseId(row, enrolledIds);
    if (cid != null && map.has(cid)) {
      map.get(cid)!.push(row);
    } else {
      map.get('unassigned')!.push(row);
    }
  }
  return map;
}

export function computeCourseProgressPercent(
  rows: SubmittedInstanceRow[],
  summaries: Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>
): number {
  if (rows.length === 0) return 0;
  let done = 0;
  for (const row of rows) {
    const sum = summaries[row.id];
    const outcome = getAssessmentOutcomeDisplay({
      status: row.status,
      role_context: row.role_context,
      attemptResults: sum
        ? [sum.final_attempt_1_result, sum.final_attempt_2_result, sum.final_attempt_3_result]
        : [],
      submissionCount: Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0),
      submittedAt: row.submitted_at ?? null,
    });
    if (outcome.label === 'Completed' || String(row.status ?? '').trim() === 'locked') done += 1;
  }
  return Math.round((done / rows.length) * 100);
}

export function unitOutcomeBadge(
  row: SubmittedInstanceRow,
  summary: { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult } | null
): { code: string; className: string } {
  const outcome = getAssessmentOutcomeDisplay({
    status: row.status,
    role_context: row.role_context,
    attemptResults: summary
      ? [summary.final_attempt_1_result, summary.final_attempt_2_result, summary.final_attempt_3_result]
      : [],
    submissionCount: Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0),
    submittedAt: row.submitted_at ?? null,
  });
  if (outcome.label === 'Completed') return { code: 'C', className: 'bg-emerald-600 text-white' };
  if (outcome.label.includes('Competent')) return { code: 'C', className: 'bg-emerald-500 text-white' };
  if (outcome.label.includes('Not Yet') || outcome.label.includes('Failed')) return { code: 'NS', className: 'bg-red-500 text-white' };
  return { code: '—', className: 'bg-gray-200 text-gray-700' };
}
