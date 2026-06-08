import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { listSubmittedInstancesPaged, type SubmittedInstanceRow } from '../lib/formEngine';
import { getAssessmentReportStatus, type AssessmentReportStatus } from '../utils/assessmentReportStatus';
import { formatDDMMYYYY } from '../utils/assessmentRowUi';

export type AssessmentReportFilters = {
  search?: string;
  courseId?: number | null;
  batchId?: number | null;
  formId?: number | null;
  studentId?: number | null;
};

export type AssessmentReportRow = {
  instanceId: number;
  studentName: string;
  unitName: string;
  startDate: string;
  endDate: string;
  status: AssessmentReportStatus;
  batchId: number | null;
  batchName: string | null;
  studentId: number | null;
  formId: number;
};

function normalizeFilterIds(filters: AssessmentReportFilters) {
  const courseId =
    filters.courseId != null && Number.isFinite(Number(filters.courseId)) && Number(filters.courseId) > 0
      ? Number(filters.courseId)
      : undefined;
  const formId =
    filters.formId != null && Number.isFinite(Number(filters.formId)) && Number(filters.formId) > 0
      ? Number(filters.formId)
      : undefined;
  const studentId =
    filters.studentId != null && Number.isFinite(Number(filters.studentId)) && Number(filters.studentId) > 0
      ? Number(filters.studentId)
      : undefined;
  const batchId =
    filters.batchId != null && Number.isFinite(Number(filters.batchId)) && Number(filters.batchId) > 0
      ? Number(filters.batchId)
      : undefined;
  return { courseId, formId, studentId, batchId };
}

async function fetchStudentBatchMap(
  studentIds: number[],
): Promise<Map<number, { batch_id: number | null; batch_name: string | null }>> {
  const map = new Map<number, { batch_id: number | null; batch_name: string | null }>();
  if (studentIds.length === 0) return map;
  const chunkSize = 500;
  for (let i = 0; i < studentIds.length; i += chunkSize) {
    const chunk = studentIds.slice(i, i + chunkSize);
    const { data } = await supabase
      .from('skyline_students')
      .select('id, batch_id, skyline_batches(name)')
      .in('id', chunk);
    for (const row of (data as Array<{
      id: number;
      batch_id: number | null;
      skyline_batches: { name: string } | null;
    }> | null) || []) {
      map.set(Number(row.id), {
        batch_id: row.batch_id != null ? Number(row.batch_id) : null,
        batch_name: row.skyline_batches?.name?.trim() ? String(row.skyline_batches.name) : null,
      });
    }
  }
  return map;
}

function toReportRow(
  row: SubmittedInstanceRow,
  batchMeta: { batch_id: number | null; batch_name: string | null },
): AssessmentReportRow {
  return {
    instanceId: row.id,
    studentName: row.student_name,
    unitName: row.form_name || '—',
    startDate: formatDDMMYYYY(row.start_date),
    endDate: formatDDMMYYYY(row.end_date),
    status: getAssessmentReportStatus(row),
    batchId: batchMeta.batch_id,
    batchName: batchMeta.batch_name,
    studentId: row.student_id,
    formId: row.form_id,
  };
}

async function mapInstancesToReportRows(instances: SubmittedInstanceRow[]): Promise<AssessmentReportRow[]> {
  const studentIds = [...new Set(instances.map((r) => r.student_id).filter((id): id is number => id != null && id > 0))];
  const batchMap = await fetchStudentBatchMap(studentIds);
  return instances.map((r) => {
    const meta =
      r.student_id != null
        ? (batchMap.get(r.student_id) ?? { batch_id: null, batch_name: null })
        : { batch_id: null, batch_name: null };
    return toReportRow(r, meta);
  });
}

function listArgs(filters: AssessmentReportFilters, page: number, pageSize: number) {
  const { courseId, formId, studentId, batchId } = normalizeFilterIds(filters);
  return [
    page,
    pageSize,
    filters.search,
    courseId,
    formId,
    studentId,
    { key: 'student' as const, dir: 'asc' as const },
    null,
    'all' as const,
    null,
    null,
    batchId ?? null,
  ] as const;
}

/** One server page for the reports table (default on page open). */
export async function fetchAssessmentReportPage(
  filters: AssessmentReportFilters,
  page: number,
  pageSize: number,
): Promise<{ data: AssessmentReportRow[]; total: number }> {
  const res = await listSubmittedInstancesPaged(...listArgs(filters, page, pageSize));
  const data = await mapInstancesToReportRows(res.data);
  return { data, total: res.total };
}

/** All matching rows — used for export only. */
export async function fetchAllAssessmentReportRows(filters: AssessmentReportFilters): Promise<AssessmentReportRow[]> {
  const all: SubmittedInstanceRow[] = [];
  const pageSize = 500;
  let page = 1;
  while (true) {
    const res = await listSubmittedInstancesPaged(...listArgs(filters, page, pageSize));
    all.push(...res.data);
    if (page * pageSize >= res.total || res.data.length === 0) break;
    page += 1;
  }

  return mapInstancesToReportRows(all);
}

export function downloadAssessmentReportCsv(rows: AssessmentReportRow[], filenamePrefix = 'assessment-reports'): void {
  const sheetData = rows.map((r) => ({
    'Assessment Instance ID': r.instanceId,
    'Student Name': r.studentName,
    'Unit Name': r.unitName,
    'Start Date': r.startDate,
    'End Date': r.endDate,
    Status: r.status,
    'Batch Name': r.batchName ?? '',
  }));

  const ws = XLSX.utils.json_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 12 },
    { wch: 40 },
    { wch: 60 },
    { wch: 14 },
    { wch: 14 },
    { wch: 70 },
    { wch: 32 },
  ];

  try {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    const statusCol = 5;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: statusCol });
      const cell = ws[addr] as { s?: unknown } | undefined;
      if (!cell) continue;
      (cell as unknown as { s: { alignment: { wrapText: boolean; vertical?: string } } }).s = {
        alignment: { wrapText: true, vertical: 'top' },
      };
    }
  } catch {
    // styling is best-effort
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Assessment Reports');
  XLSX.writeFile(wb, `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`, { cellStyles: true });
}
