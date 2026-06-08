import React, { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, BarChart3 } from 'lucide-react';
import {
  getBatchById,
  listBatchesPaged,
  listCoursesPaged,
  listFormsPaged,
  listStudentsPaged,
} from '../../../lib/formEngine';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { SelectAsync } from '../../../components/ui/SelectAsync';
import { Loader } from '../../../components/ui/Loader';
import { AdminListPagination } from '../../../components/admin/AdminListPagination';
import { toast } from '../../../utils/toast';
import {
  assessmentReportStatusClassName,
  type AssessmentReportStatus,
} from '../../../utils/assessmentReportStatus';
import {
  downloadAssessmentReportCsv,
  fetchAllAssessmentReportRows,
  fetchAssessmentReportPage,
  type AssessmentReportRow,
} from '../../../services/assessmentReports';

const PAGE_SIZE = 25;

export const AssessmentReportsPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [studentFilter, setStudentFilter] = useState('');

  const [rows, setRows] = useState<AssessmentReportRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const courseId = courseFilter ? Number(courseFilter) : null;
  const batchId = batchFilter ? Number(batchFilter) : null;
  const formId = unitFilter ? Number(unitFilter) : null;
  const studentId = studentFilter ? Number(studentFilter) : null;

  const loadCoursesOptions = useCallback(
    async (page: number, search: string) => {
      let restrict: number[] | undefined;
      if (batchId) {
        const b = await getBatchById(batchId);
        if (b?.course_id != null) restrict = [b.course_id];
      }
      const res = await listCoursesPaged(page, 20, search || undefined, restrict);
      const opts = res.data.map((c) => ({
        value: String(c.id),
        label: c.qualification_code?.trim() ? `${c.qualification_code} — ${c.name}` : c.name,
      }));
      const withAll = page === 1 && !search.trim() ? [{ value: '', label: 'All courses' }, ...opts] : opts;
      return { options: withAll, hasMore: page * 20 < res.total };
    },
    [batchId],
  );

  const loadBatchesOptions = useCallback(
    async (page: number, search: string) => {
      const courseFilterArg = courseId ?? undefined;
      const res = await listBatchesPaged(page, 20, search || undefined, courseFilterArg);
      const opts = res.data.map((b) => ({ value: String(b.id), label: b.name }));
      const withAll = page === 1 && !search.trim() ? [{ value: '', label: 'All batches' }, ...opts] : opts;
      return { options: withAll, hasMore: page * 20 < res.total };
    },
    [courseId],
  );

  const loadUnitsOptions = useCallback(
    async (page: number, search: string) => {
      const res = await listFormsPaged(page, 20, 'published', courseId ?? undefined, search || undefined);
      const opts = res.data.map((f) => ({
        value: String(f.id),
        label: f.unit_code?.trim() ? `${f.unit_code} — ${f.name}` : f.name,
      }));
      const withAll = page === 1 && !search.trim() ? [{ value: '', label: 'All units' }, ...opts] : opts;
      return { options: withAll, hasMore: page * 20 < res.total };
    },
    [courseId],
  );

  const loadStudentsOptions = useCallback(
    async (page: number, search: string) => {
      const res = await listStudentsPaged(page, 20, search || undefined, 'active', {
        batchId: batchId ?? null,
        courseIds: courseId ? [courseId] : [],
      });
      const opts = res.data.map((s) => ({
        value: String(s.id),
        label: `${s.first_name} ${s.last_name}`.trim() || s.email,
      }));
      const withAll = page === 1 && !search.trim() ? [{ value: '', label: 'All students' }, ...opts] : opts;
      return { options: withAll, hasMore: page * 20 < res.total };
    },
    [batchId, courseId],
  );

  const loadPage = useCallback(
    async (page: number, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      else setRefreshing(true);
      try {
        const { data, total } = await fetchAssessmentReportPage(
          {
            search: searchTerm.trim() || undefined,
            courseId,
            batchId,
            formId,
            studentId,
          },
          page,
          PAGE_SIZE,
        );
        setRows(data);
        setTotalRows(total);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load assessment reports');
        setRows([]);
        setTotalRows(0);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [searchTerm, courseId, batchId, formId, studentId],
  );

  useEffect(() => {
    const t = setTimeout(() => void loadPage(currentPage), 300);
    return () => clearTimeout(t);
  }, [searchTerm, courseId, batchId, formId, studentId, currentPage, loadPage]);

  const handleCourseChange = useCallback(
    (v: string) => {
      setCourseFilter(v);
      setUnitFilter('');
      setCurrentPage(1);
      if (!v) return;
      void getBatchById(Number(batchFilter)).then((b) => {
        if (batchFilter && b?.course_id != null && String(b.course_id) !== v) {
          setBatchFilter('');
          setStudentFilter('');
        }
      });
    },
    [batchFilter],
  );

  const handleBatchChange = useCallback((v: string) => {
    setBatchFilter(v);
    setStudentFilter('');
    setCurrentPage(1);
    if (!v.trim()) return;
    void getBatchById(Number(v)).then((b) => {
      if (b?.course_id != null) setCourseFilter(String(b.course_id));
    });
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const handleExport = useCallback(async () => {
    try {
      setExporting(true);
      const data = await fetchAllAssessmentReportRows({
        search: searchTerm.trim() || undefined,
        courseId,
        batchId,
        formId,
        studentId,
      });
      if (data.length === 0) {
        toast.error('No rows to export');
        return;
      }
      downloadAssessmentReportCsv(data);
      toast.success(`Exported ${data.length} row(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [searchTerm, courseId, batchId, formId, studentId]);

  const clearFilters = () => {
    setSearchTerm('');
    setCourseFilter('');
    setBatchFilter('');
    setUnitFilter('');
    setStudentFilter('');
    setCurrentPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[var(--brand)]" />
            Assessment Reports
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Filter assessments by course, batch, unit, or student. Export results as Excel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadPage(currentPage, { silent: true })}
            disabled={loading || refreshing || exporting}
            className="inline-flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleExport()}
            disabled={loading || exporting || totalRows === 0}
            className="inline-flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Export Excel'}
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search student or unit…"
            className="w-full min-w-0 sm:max-w-[min(100%,280px)] sm:flex-[1_1_200px]"
          />
          <div className="w-full min-w-0 sm:w-[14rem]">
            <SelectAsync
              label="Course"
              value={courseFilter}
              onChange={handleCourseChange}
              loadOptions={loadCoursesOptions}
              placeholder="All courses"
              selectedLabel={courseFilter ? undefined : 'All courses'}
            />
          </div>
          <div className="w-full min-w-0 sm:w-[14rem]">
            <SelectAsync
              label="Batch"
              value={batchFilter}
              onChange={handleBatchChange}
              loadOptions={loadBatchesOptions}
              placeholder="All batches"
              selectedLabel={batchFilter ? undefined : 'All batches'}
            />
          </div>
          <div className="w-full min-w-0 sm:w-[16rem]">
            <SelectAsync
              label="Unit"
              value={unitFilter}
              onChange={(v) => {
                setUnitFilter(v);
                setCurrentPage(1);
              }}
              loadOptions={loadUnitsOptions}
              placeholder="All units"
              selectedLabel={unitFilter ? undefined : 'All units'}
            />
          </div>
          <div className="w-full min-w-0 sm:w-[14rem]">
            <SelectAsync
              label="Student"
              value={studentFilter}
              onChange={(v) => {
                setStudentFilter(v);
                setCurrentPage(1);
              }}
              loadOptions={loadStudentsOptions}
              placeholder="All students"
              selectedLabel={studentFilter ? undefined : 'All students'}
            />
          </div>
          <Button type="button" variant="outline" onClick={clearFilters} disabled={loading}>
            Clear
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader variant="dots" message="Loading reports…" />
          </div>
        ) : (
          <>
            <div className="px-4 py-2 text-sm text-gray-600 border-b border-[var(--border)]">
              {totalRows} assessment{totalRows === 1 ? '' : 's'}
            </div>
            {!loading && totalRows > PAGE_SIZE ? (
              <AdminListPagination
                placement="top"
                totalItems={totalRows}
                pageSize={PAGE_SIZE}
                currentPage={currentPage}
                totalPages={totalPages}
                onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
                onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                onGoToPage={(p) => setCurrentPage(p)}
                itemLabel="assessments"
              />
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)]">Student</th>
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)]">Unit</th>
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)] whitespace-nowrap">Start date</th>
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)] whitespace-nowrap">End date</th>
                    <th className="px-3 py-2 font-semibold border-b border-[var(--border)]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                        No assessments match the current filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => <ReportRow key={row.instanceId} row={row} />)
                  )}
                </tbody>
              </table>
            </div>
            {!loading && totalRows > PAGE_SIZE ? (
              <div className="border-t border-[var(--border)] px-2">
                <AdminListPagination
                  placement="bottom"
                  totalItems={totalRows}
                  pageSize={PAGE_SIZE}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  onGoToPage={(p) => setCurrentPage(p)}
                  itemLabel="assessments"
                />
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
};

function ReportRow({ row }: { row: AssessmentReportRow }) {
  const statusClass = assessmentReportStatusClassName(row.status as AssessmentReportStatus);
  return (
    <tr className="hover:bg-[var(--brand)]/5">
      <td className="px-3 py-2 border-b border-[var(--border)] align-top font-medium text-[var(--text)]">
        {row.studentName}
      </td>
      <td className="px-3 py-2 border-b border-[var(--border)] align-top text-gray-700">{row.unitName}</td>
      <td className="px-3 py-2 border-b border-[var(--border)] align-top tabular-nums whitespace-nowrap">{row.startDate}</td>
      <td className="px-3 py-2 border-b border-[var(--border)] align-top tabular-nums whitespace-nowrap">{row.endDate}</td>
      <td className={`px-3 py-2 border-b border-[var(--border)] align-top ${statusClass}`}>{row.status}</td>
    </tr>
  );
}
