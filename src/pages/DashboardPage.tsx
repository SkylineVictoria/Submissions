import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ClipboardCheck, LayoutDashboard, Users } from 'lucide-react';
import {
  listDashboardInstances,
  getDashboardPendingCount,
  getTrainerBatchCount,
  listTrainerBatches,
  listStudentsInBatch,
  issueInstanceAccessLink,
  fetchAssessmentSummaries,
} from '../lib/formEngine';
import type { SubmittedInstanceRow, Batch, Student } from '../lib/formEngine';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';
import { AdminListPagination } from '../components/admin/AdminListPagination';
import {
  computeRowUi,
  melDateString,
  formatDDMMYYYY,
  getStudentAttemptDoneText,
  getTrainerAttemptFailedText,
  getMissedAttemptWindowText,
  type AttemptResult,
} from '../utils/assessmentRowUi';
import { FormDocumentsPanel } from '../components/documents/FormDocumentsPanel';
import { cn } from '../components/utils/cn';
import {
  rowMatchesTrainerHighlightCourse,
  TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS,
  useTrainerHighlightCourseId,
} from '../utils/trainerCourseHighlight';
import { TrainerGradeMePanel } from '../components/trainer/TrainerGradeMePanel';

const withinWindowMelbourne = (row: Pick<SubmittedInstanceRow, 'start_date' | 'end_date'>): { ok: boolean; reason?: string } => {
  const today = melDateString(new Date());
  const start = String(row.start_date ?? '').trim();
  const end = String(row.end_date ?? '').trim();
  if (start && today < start) return { ok: false, reason: `Available from ${formatDDMMYYYY(start)}` };
  if (end && today > end) return { ok: false, reason: `Expired on ${formatDDMMYYYY(end)} (23:59 AEDT)` };
  return { ok: true };
};

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
} | null): {
  label: string;
  className: string;
} {
  const r1 = summary?.final_attempt_1_result ?? null;
  const r2 = summary?.final_attempt_2_result ?? null;
  const r3 = summary?.final_attempt_3_result ?? null;
  const anyCompetent = r1 === 'competent' || r2 === 'competent' || r3 === 'competent';
  if (anyCompetent) return { label: 'Completed', className: 'text-emerald-700' };
  const anyNYC = r1 === 'not_yet_competent' || r2 === 'not_yet_competent' || r3 === 'not_yet_competent';
  if (anyNYC) return { label: 'Not competent', className: 'text-red-700' };
  return { label: 'In progress', className: 'text-gray-700' };
}

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const role = user?.role === 'trainer' ? 'trainer' : 'office';
  const PAGE_SIZE = 20;
  const [rows, setRows] = useState<SubmittedInstanceRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [batchCount, setBatchCount] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [trainerBatches, setTrainerBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [batchStudents, setBatchStudents] = useState<Student[]>([]);
  const [batchStudentsLoading, setBatchStudentsLoading] = useState(false);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const trainerHighlightCourseId = useTrainerHighlightCourseId();
  const [attemptSummaryByInstanceId, setAttemptSummaryByInstanceId] = useState<
    Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>
  >({});

  const loadData = useCallback(
    async (page: number, search: string, opts?: { silent?: boolean }) => {
      if (!user?.id) return;
      if (!opts?.silent) setLoading(true);
      const [countRes, listRes, batchCountRes, trainerBatchesRes] = await Promise.all([
        getDashboardPendingCount(role, user.id),
        listDashboardInstances(role, user.id, page, PAGE_SIZE, search, true),
        role === 'trainer' ? getTrainerBatchCount(user.id) : Promise.resolve(null),
        role === 'trainer' ? listTrainerBatches(user.id) : Promise.resolve([]),
      ]);
      setPendingCount(countRes);
      setBatchCount(batchCountRes);
      setTrainerBatches(trainerBatchesRes ?? []);
      setRows(listRes.data);
      setTotalRows(listRes.total);
      setLoading(false);
    },
    [user?.id, role]
  );

  useEffect(() => {
    const t = setTimeout(() => loadData(currentPage, searchTerm), 250);
    return () => clearTimeout(t);
  }, [currentPage, searchTerm, loadData]);

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

  useEffect(() => {
    if (role !== 'trainer' || !selectedBatchId) {
      setBatchStudents([]);
      return;
    }
    const batchId = Number(selectedBatchId);
    if (!Number.isFinite(batchId) || batchId <= 0) return;
    setBatchStudentsLoading(true);
    listStudentsInBatch(batchId).then((s) => {
      setBatchStudents(s);
      setBatchStudentsLoading(false);
    });
  }, [role, selectedBatchId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData(currentPage, searchTerm, { silent: true });
    setRefreshing(false);
    toast.success('Dashboard refreshed');
  };

  const handleOpen = async (row: SubmittedInstanceRow) => {
    const win = withinWindowMelbourne(row);
    if (!win.ok) {
      toast.error(win.reason || 'This assessment is not available right now.');
      return;
    }
    const targetRole =
      row.role_context === 'trainer'
        ? 'trainer'
        : row.role_context === 'office'
          ? 'office'
          : row.status === 'locked'
            ? role === 'office'
              ? 'office'
              : 'trainer'
            : 'student';
    const url = await issueInstanceAccessLink(row.id, targetRole);
    if (!url) {
      toast.error('Failed to open secure link');
      return;
    }
    window.open(url, '_blank');
  };

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
              <LayoutDashboard className="w-7 h-7 text-[var(--brand)]" />
              Dashboard
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              {role === 'trainer'
                ? 'Pending assessments awaiting your review'
                : 'Pending assessments awaiting office processing'}
            </p>
          </div>
        </div>

        {/* Pending and role cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <Card className="bg-gradient-to-br from-[var(--brand)] to-[#ea580c] text-white overflow-hidden relative">
            <div className="absolute top-0 right-0 w-24 h-24 -mt-4 -mr-4 rounded-full bg-white/10" />
            <div className="relative">
              <p className="text-white/90 text-sm font-medium">Pending</p>
              <p className="text-4xl font-bold mt-1">{pendingCount}</p>
              <p className="text-white/80 text-xs mt-1">
                {role === 'trainer' ? 'Awaiting your review' : 'Awaiting office check'}
              </p>
            </div>
          </Card>
          <Card className="border border-[var(--border)]">
            <p className="text-gray-600 text-sm font-medium">Role</p>
            <p className="text-xl font-bold text-[var(--text)] mt-1 capitalize">{role}</p>
            <p className="text-gray-500 text-xs mt-1">{user?.full_name}</p>
            {role === 'trainer' && batchCount !== null && (
              <p className="text-gray-600 text-xs mt-2 pt-2 border-t border-gray-100">
                Batches: <span className="font-semibold">{batchCount}</span>
              </p>
            )}
          </Card>
        </div>

        {role === 'trainer' && user?.id ? <TrainerGradeMePanel trainerUserId={user.id} /> : null}

        {role === 'trainer' && trainerBatches.length > 0 && (
          <Card className="mb-6">
            <h2 className="text-lg font-bold text-[var(--text)] flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-[var(--brand)]" />
              My batches
            </h2>
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-4">
              <div className="w-full sm:w-64">
                <Select
                  label="Select batch"
                  value={selectedBatchId}
                  onChange={setSelectedBatchId}
                  options={[
                    { value: '', label: 'Select a batch...' },
                    ...trainerBatches.map((b) => ({ value: String(b.id), label: b.name })),
                  ]}
                />
              </div>
            </div>
            {selectedBatchId && (
              <div className="border border-gray-100 rounded-lg overflow-hidden">
                {batchStudentsLoading ? (
                  <Loader variant="dots" size="md" message="Loading students..." />
                ) : batchStudents.length === 0 ? (
                  <div className="py-8 text-center text-gray-500 text-sm">No students in this batch.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="py-2.5 px-3">Student</th>
                        <th className="py-2.5 px-3">Email</th>
                        <th className="py-2.5 px-3">Student ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchStudents.map((s) => (
                        <tr key={s.id} className="border-b border-gray-100 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors">
                          <td className="py-2.5 px-3 font-medium text-gray-900">{s.name}</td>
                          <td className="py-2.5 px-3 text-gray-600">{s.email}</td>
                          <td className="py-2.5 px-3 text-gray-600">{s.student_id ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </Card>
        )}

        <Card>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Pending assessments</h2>
              <p className="text-sm text-gray-600 mt-1">Open follows the same activity window as the student view (end date 23:59 AEDT).</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search student, form..."
                className="w-[220px]"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>

          {!loading && (
            <AdminListPagination
              placement="top"
              totalItems={totalRows}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              onGoToPage={(p) => setCurrentPage(p)}
              itemLabel="items"
            />
          )}
          {loading ? (
            <Loader variant="dots" size="lg" message="Loading assessments..." />
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              <ClipboardCheck className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>No pending assessments.</p>
              <p className="text-sm mt-1">
                {role === 'trainer'
                  ? 'Pending items will appear when students submit for your review.'
                  : 'Pending items will appear once trainers submit them for office review.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)] min-w-[12rem]">Student</th>
                    <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)] min-w-[11rem]">Form</th>
                    <th className="hidden md:table-cell text-left px-3 py-2 font-semibold border-b border-[var(--border)] w-[6.5rem] whitespace-nowrap">
                      Start
                    </th>
                    <th className="hidden md:table-cell text-left px-3 py-2 font-semibold border-b border-[var(--border)] w-[6.5rem] whitespace-nowrap">End</th>
                    <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)] min-w-[12rem]">Progress</th>
                    <th className="text-right px-3 py-2 font-semibold border-b border-[var(--border)] whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const sum = attemptSummaryByInstanceId[row.id] ?? null;
                    const attemptResults: AttemptResult[] = [
                      sum?.final_attempt_1_result ?? null,
                      sum?.final_attempt_2_result ?? null,
                      sum?.final_attempt_3_result ?? null,
                    ];
                    const attemptDoneText = getStudentAttemptDoneText({
                      submissionCount: Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0),
                      submittedAt: row.submitted_at ?? null,
                      attemptResults,
                    });
                    const trainerAttemptFailedText = getTrainerAttemptFailedText(attemptResults);
                    const missedAttemptText = getMissedAttemptWindowText({
                      noAttemptRollovers: row.no_attempt_rollovers ?? null,
                      didNotAttempt: row.did_not_attempt ?? null,
                    });
                    const ui = computeRowUi({
                      row: { ...row, did_not_attempt: row.did_not_attempt ?? null },
                      attemptResults,
                    });
                    const disabled = ui.disabled;
                    const win = withinWindowMelbourne(row);
                    const outcome = getOutcomeLabel(sum);
                    const trainerHighlightExtra = rowMatchesTrainerHighlightCourse(row, trainerHighlightCourseId)
                      ? TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS
                      : '';
                    return (
                      <React.Fragment key={row.id}>
                        <tr
                          className={cn(ui.rowClassName, 'cursor-pointer', trainerHighlightExtra)}
                          onClick={() => setExpandedId((prev) => (prev === row.id ? null : row.id))}
                          title="Click to expand"
                        >
                          <td className="px-3 py-2 border-b border-[var(--border)] align-top">
                            <div className="font-medium text-[var(--text)] break-words">{row.student_name}</div>
                            <div className="text-xs text-gray-500 break-all">{row.student_email || '—'}</div>
                            <div className="md:hidden mt-1 text-xs text-gray-600 tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>
                                <span className="text-gray-500">Start</span> {formatDDMMYYYY(row.start_date)}
                              </span>
                              <span>
                                <span className="text-gray-500">End</span> {formatDDMMYYYY(row.end_date)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 border-b border-[var(--border)] align-top">
                            <div className="font-medium text-[var(--text)] break-words">{row.form_name}</div>
                            <div className="text-xs text-gray-500">v{row.form_version ?? '1.0.0'}</div>
                          </td>
                          <td className="hidden md:table-cell px-3 py-2 border-b border-[var(--border)] text-gray-700 whitespace-nowrap tabular-nums align-top">
                            {formatDDMMYYYY(row.start_date)}
                          </td>
                          <td className="hidden md:table-cell px-3 py-2 border-b border-[var(--border)] text-gray-700 whitespace-nowrap tabular-nums align-top">
                            {formatDDMMYYYY(row.end_date)}
                          </td>
                          <td className="px-3 py-2 border-b border-[var(--border)] align-top min-w-[12rem]">
                            <div className="flex flex-col gap-1">
                              <span
                                className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${getWorkflowBadgeClass(row)}`}
                              >
                                {getWorkflowLabel(row)}
                              </span>
                              <div
                                className={`text-xs font-medium ${
                                  ui.kind === 'past_not_competent'
                                    ? ui.outcomeClassName ?? ''
                                    : ui.kind === 'past_competent'
                                      ? ui.outcomeClassName ?? ''
                                      : outcome.className
                                }`}
                              >
                                {ui.kind === 'past_not_competent'
                                  ? ui.outcomeLabel
                                  : ui.kind === 'past_competent'
                                    ? ui.outcomeLabel
                                    : outcome.label}
                              </div>
                              {attemptDoneText ? <div className="text-[11px] text-gray-600">{attemptDoneText}</div> : null}
                              {ui.kind === 'in_progress' && missedAttemptText ? (
                                <div className="text-[11px] font-medium text-amber-700">{missedAttemptText}</div>
                              ) : null}
                              {trainerAttemptFailedText ? (
                                <div className="text-[11px] font-medium text-red-700">{trainerAttemptFailedText}</div>
                              ) : null}
                              {disabled && (ui.kind === 'future' || ui.kind === 'expired') ? (
                                <div className="text-xs text-amber-700">{ui.reason}</div>
                              ) : !win.ok ? (
                                <div className="text-xs text-amber-700">{win.reason}</div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2 border-b border-[var(--border)] text-right align-top">
                            <div className="text-xs text-gray-500">—</div>
                          </td>
                        </tr>
                        {expandedId === row.id ? (
                          <tr className={cn(ui.rowClassName, trainerHighlightExtra)}>
                            <td className="px-3 py-3 border-b border-[var(--border)]" colSpan={6} onClick={(e) => e.stopPropagation()}>
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                <FormDocumentsPanel
                                  formId={Number(row.form_id)}
                                  formName={String(row.form_name ?? 'Assessment')}
                                  canUpload={false}
                                  showTrainerSection={role === 'trainer'}
                                />
                                <button
                                  type="button"
                                  className="rounded-lg border border-[var(--border)] bg-white p-4 text-left hover:bg-[var(--brand)]/10 focus-visible:bg-[var(--brand)]/10 transition-colors"
                                  onClick={() => void handleOpen(row)}
                                  disabled={disabled}
                                  title="Open assessment"
                                >
                                  <div className="text-sm font-semibold text-[var(--text)]">Assessment</div>
                                  <div className="mt-1 text-xs text-gray-600 break-words">{row.form_name}</div>
                                  <div className="mt-3 inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700">
                                    Open
                                  </div>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!loading && (
            <AdminListPagination
              placement="bottom"
              totalItems={totalRows}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              onGoToPage={(p) => setCurrentPage(p)}
              itemLabel="items"
            />
          )}
        </Card>
      </div>
    </div>
  );
};
