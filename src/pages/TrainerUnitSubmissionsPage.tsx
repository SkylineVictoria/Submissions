import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Loader } from '../components/ui/Loader';
import { AdminListPagination } from '../components/admin/AdminListPagination';
import {
  extendInstanceAccessTokensToDate,
  fetchAssessmentSummaries,
  issueInstanceAccessLink,
  listTrainerUnitInstancesPaged,
  updateFormInstanceDates,
  type SubmittedInstanceRow,
} from '../lib/formEngine';
import { formatDDMMYYYY, type AttemptResult } from '../utils/assessmentRowUi';
import { cn } from '../components/utils/cn';
import { DatePicker } from '../components/ui/DatePicker';
import { toast } from '../utils/toast';

const getWorkflowLabel = (row: SubmittedInstanceRow): string => {
  if (row.status === 'locked') return 'Completed';
  if (row.status === 'draft') return 'Awaiting Student';
  if (row.role_context === 'trainer') return 'Waiting Trainer';
  if (row.role_context === 'office') return 'Waiting Office';
  return 'Submitted';
};

const getWorkflowBadgeClass = (row: SubmittedInstanceRow): string => {
  if (row.status === 'locked') return 'bg-emerald-100 text-emerald-800';
  if (row.status === 'draft') return 'bg-slate-100 text-slate-700';
  if (row.role_context === 'trainer') return 'bg-amber-100 text-amber-800';
  if (row.role_context === 'office') return 'bg-blue-100 text-blue-800';
  return 'bg-gray-100 text-gray-700';
};

function getOutcomeLabel(summary: {
  final_attempt_1_result: AttemptResult;
  final_attempt_2_result: AttemptResult;
  final_attempt_3_result: AttemptResult;
} | null): { label: string; className: string } {
  const r1 = summary?.final_attempt_1_result ?? null;
  const r2 = summary?.final_attempt_2_result ?? null;
  const r3 = summary?.final_attempt_3_result ?? null;
  const anyCompetent = r1 === 'competent' || r2 === 'competent' || r3 === 'competent';
  if (anyCompetent) return { label: 'Completed', className: 'text-emerald-700' };
  const anyNYC = r1 === 'not_yet_competent' || r2 === 'not_yet_competent' || r3 === 'not_yet_competent';
  if (anyNYC) return { label: 'Not competent', className: 'text-red-700' };
  return { label: 'In progress', className: 'text-gray-700' };
}

export const TrainerUnitSubmissionsPage: React.FC = () => {
  const { user } = useAuth();
  const params = useParams();
  const formId = Number(params.formId);
  const PAGE_SIZE = 20;

  const [rows, setRows] = useState<SubmittedInstanceRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [savingDatesId, setSavingDatesId] = useState<number | null>(null);
  const [attemptSummaryByInstanceId, setAttemptSummaryByInstanceId] = useState<
    Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>
  >({});

  const load = useCallback(
    async (page: number, q: string) => {
      const uid = user?.id;
      if (!uid) return;
      if (!Number.isFinite(formId) || formId <= 0) return;
      setLoading(true);
      const res = await listTrainerUnitInstancesPaged(uid, formId, page, PAGE_SIZE, q);
      setRows(res.data);
      setTotalRows(res.total);
      setLoading(false);
    },
    [user?.id, formId]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      void load(currentPage, searchTerm);
    }, 250);
    return () => clearTimeout(t);
  }, [currentPage, searchTerm, load]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  useEffect(() => {
    if (rows.length === 0) {
      setAttemptSummaryByInstanceId({});
      return;
    }
    const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    let cancelled = false;
    void (async () => {
      const m = await fetchAssessmentSummaries(ids);
      if (cancelled) return;
      setAttemptSummaryByInstanceId(
        m as Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const unitTitle = useMemo(() => rows[0]?.form_name || 'Unit submissions', [rows]);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const handleInstanceDatesChange = async (
    row: SubmittedInstanceRow,
    field: 'start_date' | 'end_date',
    value: string | null
  ) => {
    const v = value?.trim() || null;
    const nextStart = field === 'start_date' ? v : row.start_date ?? null;
    const nextEnd = field === 'end_date' ? v : row.end_date ?? null;
    if (nextStart && nextEnd && nextStart > nextEnd) {
      toast.error('Start date cannot be later than end date');
      return;
    }
    try {
      setSavingDatesId(row.id);
      await updateFormInstanceDates(row.id, { [field]: v });
      if (field === 'end_date' && nextEnd) {
        await extendInstanceAccessTokensToDate(row.id, 'student', nextEnd);
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? {
                ...r,
                start_date: field === 'start_date' ? v : r.start_date,
                end_date: field === 'end_date' ? v : r.end_date,
              }
            : r
        )
      );
      toast.success('Dates updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update dates');
      void load(currentPage, searchTerm);
    } finally {
      setSavingDatesId(null);
    }
  };

  const handleOpen = async (row: SubmittedInstanceRow) => {
    setOpeningId(row.id);
    const url = await issueInstanceAccessLink(row.id, 'trainer');
    setOpeningId(null);
    if (!url) return;
    window.open(url, '_blank');
  };

  if (user && user.role !== 'trainer') return <Navigate to="/admin/dashboard" replace />;
  if (!Number.isFinite(formId) || formId <= 0) return <Navigate to="/admin/course-units" replace />;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <div className="mb-6 flex flex-col gap-3">
          <Link to="/admin/course-units" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="w-4 h-4" />
            Back to course units
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
                <ClipboardCheck className="w-7 h-7 text-[var(--brand)]" />
                {unitTitle}
              </h1>
              <p className="text-sm text-gray-600 mt-1">All student submissions/instances for this unit (your batches only).</p>
            </div>
          </div>
        </div>

        <Card className="mb-4">
          <div className="grid gap-3 md:grid-cols-2 md:items-end">
            <div className="max-w-xl">
              <Input
                label="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Student name, email, student id…"
              />
            </div>
            <div className="flex md:justify-end">
              <Button variant="outline" onClick={() => void load(currentPage, searchTerm)} disabled={loading}>
                Refresh
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          {loading ? (
            <div className="py-10">
              <Loader variant="dots" size="lg" message="Loading submissions..." />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-600">No submissions found for this unit.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 px-3">Student</th>
                    <th className="py-3 px-3 w-[130px] hidden lg:table-cell">Start</th>
                    <th className="py-3 px-3 w-[130px] hidden lg:table-cell">End</th>
                    <th className="py-3 px-3 min-w-[170px]">Workflow</th>
                    <th className="py-3 px-3 w-[120px]">Submitted</th>
                    <th className="py-3 px-3 w-[110px] text-right">Attempts</th>
                    <th className="py-3 px-3 w-[160px] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const outcome = getOutcomeLabel(attemptSummaryByInstanceId[row.id] ?? null);
                    return (
                      <tr key={row.id} className="border-b border-gray-100 hover:bg-[var(--brand)]/10 transition-colors">
                        <td className="py-3 px-3 align-top">
                          <div className="font-medium text-gray-900 break-words">{row.student_name}</div>
                          <div className="text-xs text-gray-500 break-all">{row.student_email || '—'}</div>
                          <div className="text-xs text-gray-400 mt-1">Instance #{row.id}</div>
                          <div className="lg:hidden mt-3 space-y-2">
                            <DatePicker
                              label="Start"
                              value={row.start_date ?? ''}
                              onChange={(v) => void handleInstanceDatesChange(row, 'start_date', v)}
                              disabled={savingDatesId === row.id}
                              compact
                              className="max-w-[200px]"
                            />
                            <DatePicker
                              label="End"
                              value={row.end_date ?? ''}
                              onChange={(v) => void handleInstanceDatesChange(row, 'end_date', v)}
                              disabled={savingDatesId === row.id}
                              compact
                              className="max-w-[200px]"
                              minDate={row.start_date ?? undefined}
                            />
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top hidden lg:table-cell">
                          <DatePicker
                            value={row.start_date ?? ''}
                            onChange={(v) => void handleInstanceDatesChange(row, 'start_date', v)}
                            disabled={savingDatesId === row.id}
                            compact
                            className="max-w-[140px]"
                          />
                        </td>
                        <td className="py-3 px-3 align-top hidden lg:table-cell">
                          <DatePicker
                            value={row.end_date ?? ''}
                            onChange={(v) => void handleInstanceDatesChange(row, 'end_date', v)}
                            disabled={savingDatesId === row.id}
                            compact
                            className="max-w-[140px]"
                            minDate={row.start_date ?? undefined}
                          />
                        </td>
                        <td className="py-3 px-3 align-top">
                          <div className="flex flex-col gap-1">
                            <span className={cn('inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium', getWorkflowBadgeClass(row))}>
                              {getWorkflowLabel(row)}
                            </span>
                            <div className={cn('text-xs font-medium', outcome.className)}>{outcome.label}</div>
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top text-gray-700 whitespace-nowrap tabular-nums">
                          {row.submitted_at ? formatDDMMYYYY(row.submitted_at) : '—'}
                        </td>
                        <td className="py-3 px-3 align-top text-right text-gray-700 tabular-nums">
                          {row.submission_count || 0}
                        </td>
                        <td className="py-3 px-3 align-top text-right">
                          <Button onClick={() => void handleOpen(row)} disabled={openingId === row.id} size="sm">
                            {openingId === row.id ? <Loader variant="dots" size="sm" inline className="mr-2" /> : null}
                            Open
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading ? (
            <AdminListPagination
              placement="bottom"
              totalItems={totalRows}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              onGoToPage={(p) => setCurrentPage(p)}
              itemLabel="submissions"
            />
          ) : null}
        </Card>
      </div>
    </div>
  );
};

