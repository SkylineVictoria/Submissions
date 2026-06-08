import { melDateString } from './assessmentRowUi';

export type AssessmentReportStatus = 'Completed' | 'In Progress' | 'Failed';

/** Report status: completed (locked), failed (past end date or did not attempt), otherwise in progress. */
export function getAssessmentReportStatus(row: {
  status?: string | null;
  end_date?: string | null;
  did_not_attempt?: boolean | null;
}): AssessmentReportStatus {
  const st = String(row.status ?? '').trim();
  if (st === 'locked') return 'Completed';
  if (Boolean(row.did_not_attempt)) return 'Failed';
  const end = String(row.end_date ?? '').trim();
  if (end) {
    const today = melDateString();
    if (today > end) return 'Failed';
  }
  return 'In Progress';
}

export function assessmentReportStatusClassName(status: AssessmentReportStatus): string {
  if (status === 'Completed') return 'text-emerald-700 font-medium';
  if (status === 'Failed') return 'text-red-700 font-medium';
  return 'text-amber-700 font-medium';
}
