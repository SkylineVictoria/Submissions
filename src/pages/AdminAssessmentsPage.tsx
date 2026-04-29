import React, { useEffect, useState, useCallback } from 'react';
import { Copy, ExternalLink, Send, RefreshCw, Ban, CheckCircle, User, Download } from 'lucide-react';
import {
  listSubmittedInstancesPaged,
  updateInstanceRole,
  updateInstanceWorkflowStatus,
  issueInstanceAccessLink,
  getOrIssueInstanceAccessLink,
  revokeRoleAccessTokens,
  extendInstanceAccessTokens,
  extendInstanceAccessTokensToDate,
  allowStudentResubmission,
  listTrainers,
  updateFormInstanceDates,
  listCoursesPaged,
  listFormsPaged,
} from '../lib/formEngine';
import type { AssessmentDirectoryWorkflowFilter, SubmittedInstanceRow, Trainer } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { DatePicker } from '../components/ui/DatePicker';
import { SelectAsync } from '../components/ui/SelectAsync';
import { Loader } from '../components/ui/Loader';
import { Modal } from '../components/ui/Modal';
import { toast } from '../utils/toast';
import { AdminListPagination } from '../components/admin/AdminListPagination';
import type { SortDirection } from '../components/admin/SortableTh';
import { SortableTh } from '../components/admin/SortableTh';
import { supabase } from '../lib/supabase';
import { computeRowUi, getMissedAttemptWindowText } from '../utils/assessmentRowUi';
import { FormDocumentsPanel } from '../components/documents/FormDocumentsPanel';
import { useAuth } from '../contexts/AuthContext';
import {
  rowMatchesTrainerHighlightCourse,
  TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS,
  useTrainerHighlightCourseId,
} from '../utils/trainerCourseHighlight';

const PDF_BASE = import.meta.env.VITE_PDF_API_URL ?? '';

const pad2 = (n: number) => String(n).padStart(2, '0');

const formatDDMMYYYY = (value: string | null): string => {
  const v = (value ?? '').trim();
  if (!v) return '-';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return v;
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};

const getWorkflowLabel = (row: SubmittedInstanceRow): string => {
  if (row.status === 'locked') return 'Completed';
  if (row.role_context === 'trainer') return 'Waiting Trainer';
  if (row.role_context === 'office') return 'Waiting Office';
  if (row.status === 'draft') return 'Awaiting Student';
  return 'Submitted (Not Sent)';
};

const WORKFLOW_FILTER_OPTIONS: { value: AssessmentDirectoryWorkflowFilter; label: string }[] = [
  { value: 'all', label: 'All workflows' },
  { value: 'awaiting_student', label: 'Awaiting student' },
  { value: 'awaiting_trainer', label: 'Waiting trainer' },
  { value: 'awaiting_office', label: 'Waiting office' },
  { value: 'completed', label: 'Completed' },
];

const getWorkflowBadgeClass = (row: SubmittedInstanceRow): string => {
  const base = 'border border-gray-200/80';
  if (row.status === 'locked') return `${base} bg-emerald-50 text-emerald-800`;
  if (row.role_context === 'trainer') return `${base} bg-amber-50 text-amber-800`;
  if (row.role_context === 'office') return `${base} bg-sky-50 text-sky-800`;
  if (row.status === 'draft') return `${base} bg-gray-50 text-gray-700`;
  return `${base} bg-gray-50 text-gray-600`;
};

const getDirectoryRowClass = (row: SubmittedInstanceRow, trainerHighlightCourseId: number | null = null): string => {
  // Match dashboards:
  // - Open window => yellow
  // - Completed => green
  // - Missed all (did_not_attempt) => red
  // - Otherwise keep neutral gray but hover with theme
  let base: string;
  if (row.status === 'locked') {
    base = 'bg-emerald-50/70 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors';
  } else {
    const ui = computeRowUi({
      row: {
        start_date: row.start_date,
        end_date: row.end_date,
        did_not_attempt: (row as unknown as { did_not_attempt?: boolean | null }).did_not_attempt ?? null,
      },
    });
    base = ui.rowClassName || 'hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors';
  }
  if (trainerHighlightCourseId != null && rowMatchesTrainerHighlightCourse(row, trainerHighlightCourseId)) {
    return `${base} ${TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS}`;
  }
  return base;
};

export const AdminAssessmentsPage: React.FC = () => {
  const { user } = useAuth();
  const trainerHighlightCourseId = useTrainerHighlightCourseId();
  const viewerIsSuperadmin = user?.role === 'superadmin';
  const PAGE_SIZE = 20;
  const [rows, setRows] = useState<SubmittedInstanceRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [managingId, setManagingId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [formFilter, setFormFilter] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState<AssessmentDirectoryWorkflowFilter>('all');
  const [sendToTrainerRow, setSendToTrainerRow] = useState<SubmittedInstanceRow | null>(null);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [trainersLoading, setTrainersLoading] = useState(false);
  const [selectedTrainerId, setSelectedTrainerId] = useState<number | null>(null);
  const [editingDateCell, setEditingDateCell] = useState<{ id: number; field: 'start' | 'end' } | null>(null);
  const [savingDateId, setSavingDateId] = useState<number | null>(null);
  /** Pending start/end edits until user clicks Apply or Mass apply */
  const [dateDrafts, setDateDrafts] = useState<Record<number, { start?: string | null; end?: string | null }>>({});
  const [massApplying, setMassApplying] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  type DirectorySortKey = 'student' | 'form' | 'start' | 'end' | 'created' | 'workflow';
  const [directorySort, setDirectorySort] = useState<{ key: DirectorySortKey; dir: SortDirection }>({
    key: 'student',
    dir: 'asc',
  });

  const loadRows = useCallback(async (page: number, search: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const courseId = courseFilter ? Number(courseFilter) : undefined;
    const formId = formFilter ? Number(formFilter) : undefined;
    const res = await listSubmittedInstancesPaged(
      page,
      PAGE_SIZE,
      search,
      courseId,
      formId,
      undefined,
      {
        key: directorySort.key,
        dir: directorySort.dir,
      },
      null,
      workflowFilter
    );
    setRows(res.data);
    setTotalRows(res.total);
    setLoading(false);
  }, [courseFilter, formFilter, directorySort, workflowFilter]);

  const loadCoursesOptions = useCallback(async (page: number, search: string) => {
    const res = await listCoursesPaged(page, 20, search ? search.trim() : undefined);
    const opts = res.data.map((c) => ({ value: String(c.id), label: c.name }));
    const withAll = page === 1 && !search?.trim() ? [{ value: '', label: 'All courses' }, ...opts] : opts;
    return { options: withAll, hasMore: page * 20 < res.total };
  }, []);

  const loadFormsOptions = useCallback(async (page: number, search: string) => {
    const cid = courseFilter ? Number(courseFilter) : undefined;
    const res = await listFormsPaged(page, 20, undefined, cid, search || undefined, { asAdmin: true });
    const opts = res.data.map((f) => ({ value: String(f.id), label: `${f.name} (v${f.version ?? '1.0.0'})` }));
    const withAll = page === 1 && !search?.trim() ? [{ value: '', label: 'All forms' }, ...opts] : opts;
    return { options: withAll, hasMore: page * 20 < res.total };
  }, [courseFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadRows(currentPage, searchTerm);
    }, 250);
    return () => clearTimeout(t);
  }, [currentPage, searchTerm, courseFilter, formFilter, loadRows]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, courseFilter, formFilter, workflowFilter]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadRows(currentPage, searchTerm, { silent: true });
    setRefreshing(false);
    toast.success('Assessments refreshed');
  };

  const handleCopyLink = async (instanceId: number, roleContext: 'student' | 'trainer' | 'office') => {
    const url = await getOrIssueInstanceAccessLink(instanceId, roleContext);
    if (!url) {
      toast.error('Failed to create secure link');
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success('Instance link copied');
  };

  const handleExpireLink = async (instanceId: number, roleContext: 'student' | 'trainer' | 'office') => {
    setManagingId(instanceId);
    await revokeRoleAccessTokens(instanceId, roleContext);
    setManagingId(null);
    await loadRows(currentPage, searchTerm, { silent: true });
    toast.success('Link expired. Student/trainer will not be able to access until you enable it.');
  };

  const handleEnableLink = async (instanceId: number, roleContext: 'student' | 'trainer' | 'office') => {
    setManagingId(instanceId);
    await extendInstanceAccessTokens(instanceId, roleContext, 30);
    setManagingId(null);
    await loadRows(currentPage, searchTerm, { silent: true });
    toast.success('Link re-enabled for 30 days.');
  };

  const openSendToTrainer = (row: SubmittedInstanceRow) => {
    // If this student's batch has a trainer, auto-send immediately (no manual modal).
    const instanceId = Number(row.id);
    const sid = Number(row.student_id);
    if (Number.isFinite(instanceId) && instanceId > 0 && Number.isFinite(sid) && sid > 0) {
      void (async () => {
        try {
          const { data: sRow } = await supabase
            .from('skyline_students')
            .select('batch_id')
            .eq('id', sid)
            .maybeSingle();
          const bid = Number((sRow as { batch_id?: number | null } | null)?.batch_id ?? 0);
          if (!Number.isFinite(bid) || bid <= 0) throw new Error('No batch');
          const { data: bRow } = await supabase
            .from('skyline_batches')
            .select('trainer_id, skyline_users(full_name, email)')
            .eq('id', bid)
            .maybeSingle();
          const tid = Number((bRow as { trainer_id?: number | null } | null)?.trainer_id ?? 0);
          if (!Number.isFinite(tid) || tid <= 0) throw new Error('No trainer');

          const u = (bRow as unknown as { skyline_users?: { full_name?: string | null; email?: string | null } | null } | null)?.skyline_users;
          const trainerName = String(u?.full_name ?? '').trim() || 'trainer';

          // Ensure trainer sees editable form (trainer can only edit in waiting_trainer workflow).
          setSendingId(instanceId);
          if (row.status === 'draft') {
            await updateInstanceWorkflowStatus(instanceId, 'waiting_trainer');
            setRows((prev) => prev.map((r) => (r.id === instanceId ? { ...r, status: 'submitted' } : r)));
          }
          if (row.role_context !== 'trainer') {
            await updateInstanceRole(instanceId, 'trainer');
            setRows((prev) => prev.map((r) => (r.id === instanceId ? { ...r, role_context: 'trainer' } : r)));
          }
          const url = await issueInstanceAccessLink(instanceId, 'trainer');
          setSendingId(null);
          if (!url) {
            toast.error('Failed to create secure link');
            return;
          }
          await navigator.clipboard.writeText(url);
          await loadRows(currentPage, searchTerm, { silent: true });
          toast.success(`Link copied for ${trainerName}. Share it with them.`);
          return;
        } catch {
          // Fallback to manual selection modal (no batch trainer configured)
        }

        setSendToTrainerRow(row);
        setSelectedTrainerId(null);
        setTrainersLoading(true);
        listTrainers().then((list) => {
          setTrainers(list);
          setTrainersLoading(false);
        });
      })();
      return;
    }

    // Fallback: manual selection modal
    setSendToTrainerRow(row);
    setSelectedTrainerId(null);
    setTrainersLoading(true);
    listTrainers().then((list) => {
      setTrainers(list);
      setTrainersLoading(false);
    });
  };

  const getEffectiveStart = useCallback(
    (row: SubmittedInstanceRow) => {
      const d = dateDrafts[row.id];
      if (d && 'start' in d) return String(d.start ?? '').trim();
      return String(row.start_date ?? '').trim();
    },
    [dateDrafts]
  );

  const getEffectiveEnd = useCallback(
    (row: SubmittedInstanceRow) => {
      const d = dateDrafts[row.id];
      if (d && 'end' in d) return String(d.end ?? '').trim();
      return String(row.end_date ?? '').trim();
    },
    [dateDrafts]
  );

  const hasRowDateChanges = useCallback(
    (row: SubmittedInstanceRow) => {
      const es = getEffectiveStart(row);
      const ee = getEffectiveEnd(row);
      const rs = String(row.start_date ?? '').trim();
      const re = String(row.end_date ?? '').trim();
      return es !== rs || ee !== re;
    },
    [getEffectiveStart, getEffectiveEnd]
  );

  const applyRowDates = useCallback(
    async (row: SubmittedInstanceRow, opts?: { silent?: boolean }) => {
      const nextStart = getEffectiveStart(row) || null;
      const nextEnd = getEffectiveEnd(row) || null;
      if (nextStart && nextEnd && nextStart > nextEnd) {
        toast.error('Start date cannot be later than end date');
        return;
      }
      try {
        setSavingDateId(row.id);
        await updateFormInstanceDates(row.id, { start_date: nextStart, end_date: nextEnd });
        if (nextEnd) await extendInstanceAccessTokensToDate(row.id, 'student', nextEnd);
        setDateDrafts((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        setEditingDateCell(null);
        await loadRows(currentPage, searchTerm, { silent: true });
        if (!opts?.silent) toast.success('Dates updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update dates');
      } finally {
        setSavingDateId(null);
      }
    },
    [currentPage, getEffectiveEnd, getEffectiveStart, loadRows, searchTerm]
  );

  const massApplyDates = useCallback(async () => {
    const targets = rows.filter(hasRowDateChanges);
    if (targets.length === 0) return;
    setMassApplying(true);
    let ok = 0;
    try {
      for (const row of targets) {
        const nextStart = getEffectiveStart(row) || null;
        const nextEnd = getEffectiveEnd(row) || null;
        if (nextStart && nextEnd && nextStart > nextEnd) {
          toast.error(`Skipped ${row.form_name}: start cannot be after end`);
          continue;
        }
        await updateFormInstanceDates(row.id, { start_date: nextStart, end_date: nextEnd });
        if (nextEnd) await extendInstanceAccessTokensToDate(row.id, 'student', nextEnd);
        setDateDrafts((prev) => {
          const n = { ...prev };
          delete n[row.id];
          return n;
        });
        ok++;
      }
      setEditingDateCell(null);
      await loadRows(currentPage, searchTerm, { silent: true });
      toast.success(`Updated ${ok} assessment${ok !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mass apply failed');
    } finally {
      setMassApplying(false);
    }
  }, [rows, currentPage, getEffectiveEnd, getEffectiveStart, hasRowDateChanges, loadRows, searchTerm]);

  const handleSendToTrainerConfirm = async () => {
    if (!sendToTrainerRow || !selectedTrainerId) return;
    const trainer = trainers.find((t) => t.id === selectedTrainerId);
    setSendingId(sendToTrainerRow.id);
    // Ensure trainer sees editable form (trainer can only edit in waiting_trainer workflow).
    if (sendToTrainerRow.status === 'draft') {
      await updateInstanceWorkflowStatus(sendToTrainerRow.id, 'waiting_trainer');
      setRows((prev) => prev.map((r) => (r.id === sendToTrainerRow.id ? { ...r, status: 'submitted' } : r)));
    }
    if (sendToTrainerRow.role_context !== 'trainer') {
      await updateInstanceRole(sendToTrainerRow.id, 'trainer');
      setRows((prev) => prev.map((r) => (r.id === sendToTrainerRow.id ? { ...r, role_context: 'trainer' } : r)));
    }
    const url = await issueInstanceAccessLink(sendToTrainerRow.id, 'trainer');
    setSendingId(null);
    setSendToTrainerRow(null);
    setSelectedTrainerId(null);
    if (!url) {
      toast.error('Failed to create secure link');
      return;
    }
    await navigator.clipboard.writeText(url);
    await loadRows(currentPage, searchTerm, { silent: true });
    toast.success(`Link copied for ${trainer?.full_name ?? 'trainer'}. Share it with them.`);
  };

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const toggleDirectorySort = (key: DirectorySortKey) => {
    setDirectorySort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      return { key: prev.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
    setCurrentPage(1);
  };

  const sortedRows = rows;

  const renderAssessmentActions = (row: SubmittedInstanceRow, mode: 'toolbar' | 'stack') => {
    const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student';
    const submissionCount = Number((row as unknown as { submission_count?: number }).submission_count ?? 0);
    const showResubmit =
      row.status !== 'locked' &&
      (row.role_context === 'trainer' || row.role_context === 'office') &&
      (submissionCount > 0 || !!row.submitted_at) &&
      submissionCount < 3;

    const actionBtn =
      'relative group inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-[var(--brand)]/10 hover:border-[var(--brand)]/40 hover:text-[var(--brand)] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-200 disabled:hover:text-gray-600';
    const actionIcon = 'w-4 h-4 shrink-0';
    // 3D-style hover label (tooltip) for icon-only buttons.
    const actionText =
      'pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-800 shadow-[0_10px_20px_rgba(0,0,0,0.15)] opacity-0 scale-95 transition-all duration-150 group-hover:opacity-100 group-hover:scale-100';

    const openLinkAs = async (targetRole: 'student' | 'trainer' | 'office') => {
      const url = await getOrIssueInstanceAccessLink(row.id, targetRole);
      if (!url) {
        toast.error('Failed to open secure link');
        return;
      }
      window.open(url, '_blank');
    };
    const openLink = async () => openLinkAs(role);

    const pdfBase = PDF_BASE.replace(/\/$/, '');
    const downloadPdfHref = pdfBase ? `${pdfBase}/pdf/${row.id}?role=office&download=1` : '';

    if (mode === 'stack') {
      return (
        <div className="mt-3 flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center border-[#ea580c]/40 text-[#c2410c] hover:bg-[#fff7ed]"
            onClick={() => void applyRowDates(row)}
            disabled={!hasRowDateChanges(row) || savingDateId === row.id || massApplying}
          >
            Apply dates
          </Button>
          <Button variant="outline" size="sm" className="w-full justify-center" onClick={openLink}>
            <ExternalLink className="mr-2 h-4 w-4 shrink-0" />
            Open
          </Button>
          <a
            href={downloadPdfHref}
            target="_blank"
            rel="noopener noreferrer"
            className={!downloadPdfHref ? 'pointer-events-none opacity-50' : undefined}
            title={!downloadPdfHref ? 'Set VITE_PDF_API_URL to the PDF server URL' : 'Download PDF'}
          >
            <Button variant="outline" size="sm" className="w-full justify-center" disabled={!downloadPdfHref}>
              <Download className="mr-2 h-4 w-4 shrink-0" />
              Download PDF
            </Button>
          </a>
          <Button variant="outline" size="sm" className="w-full justify-center" onClick={() => void handleCopyLink(row.id, role)}>
            <Copy className="mr-2 h-4 w-4 shrink-0" />
            Copy link
          </Button>
          {!row.link_expired && (
            <Button variant="outline" size="sm" className="w-full justify-center" onClick={() => void handleExpireLink(row.id, role)} disabled={managingId === row.id}>
              <Ban className="mr-2 h-4 w-4 shrink-0" />
              Expire link
            </Button>
          )}
          {row.link_expired && (
            <Button variant="outline" size="sm" className="w-full justify-center" onClick={() => void handleEnableLink(row.id, role)} disabled={managingId === row.id}>
              <CheckCircle className="mr-2 h-4 w-4 shrink-0" />
              Enable link
            </Button>
          )}
          {showResubmit && (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-center"
              onClick={async () => {
                setManagingId(row.id);
                await allowStudentResubmission(row.id);
                setManagingId(null);
                await loadRows(currentPage, searchTerm, { silent: true });
                const url = `${window.location.origin}/forms/${row.form_id}/student-access`;
                await navigator.clipboard.writeText(url);
                toast.success('Resubmission allowed. Generic link copied—student uses email and OTP.');
              }}
              disabled={managingId === row.id}
            >
              <CheckCircle className="mr-2 h-4 w-4 shrink-0" />
              Allow resubmission
            </Button>
          )}
          {(row.status === 'submitted' || row.status === 'draft') && (
            <Button variant="outline" size="sm" className="w-full justify-center" onClick={() => openSendToTrainer(row)} disabled={sendingId === row.id}>
              <Send className="mr-2 h-4 w-4 shrink-0" />
              {sendingId === row.id ? 'Sending...' : row.role_context === 'trainer' ? 'Resend to Trainer' : 'Send to Trainer'}
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => void applyRowDates(row)}
          disabled={!hasRowDateChanges(row) || savingDateId === row.id || massApplying}
          className="relative group inline-flex h-8 min-w-[3.25rem] shrink-0 items-center justify-center rounded-md border border-[#ea580c]/40 bg-white px-2 text-xs font-semibold text-[#c2410c] hover:bg-[#fff7ed] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
          aria-label="Apply date changes"
        >
          Apply
        </button>
        <button type="button" onClick={openLink} className={actionBtn} aria-label="Open">
          <ExternalLink className={actionIcon} />
          <span className={actionText}>Open</span>
        </button>
        <a
          href={downloadPdfHref}
          target="_blank"
          rel="noopener noreferrer"
          className={actionBtn}
          aria-disabled={!downloadPdfHref}
          onClick={(e) => {
            if (!downloadPdfHref) e.preventDefault();
          }}
          aria-label="Download PDF"
        >
          <Download className={actionIcon} />
          <span className={actionText}>Download PDF</span>
        </a>
        <button type="button" onClick={() => void handleCopyLink(row.id, role)} className={actionBtn} aria-label="Copy link">
          <Copy className={actionIcon} />
          <span className={actionText}>Copy link</span>
        </button>
        {!row.link_expired && (
          <button type="button" onClick={() => void handleExpireLink(row.id, role)} disabled={managingId === row.id} className={actionBtn} aria-label="Expire link">
            <Ban className={actionIcon} />
            <span className={actionText}>Expire</span>
          </button>
        )}
        {row.link_expired && (
          <button type="button" onClick={() => void handleEnableLink(row.id, role)} disabled={managingId === row.id} className={actionBtn} aria-label="Enable link">
            <CheckCircle className={actionIcon} />
            <span className={actionText}>Enable</span>
          </button>
        )}
        {showResubmit && (
          <button
            type="button"
            onClick={async () => {
              setManagingId(row.id);
              await allowStudentResubmission(row.id);
              setManagingId(null);
              await loadRows(currentPage, searchTerm, { silent: true });
              const url = `${window.location.origin}/forms/${row.form_id}/student-access`;
              await navigator.clipboard.writeText(url);
              toast.success('Resubmission allowed. Generic link copied—student uses email and OTP.');
            }}
            disabled={managingId === row.id}
            className={actionBtn}
            aria-label="Allow resubmission"
          >
            <CheckCircle className={actionIcon} />
            <span className={actionText}>Allow resubmission</span>
          </button>
        )}
        {(row.status === 'submitted' || row.status === 'draft') && (
          <button type="button" onClick={() => openSendToTrainer(row)} disabled={sendingId === row.id} className={actionBtn} aria-label={row.role_context === 'trainer' ? 'Resend to trainer' : 'Send to trainer'}>
            <Send className={actionIcon} />
            <span className={actionText}>
              {sendingId === row.id ? 'Sending…' : row.role_context === 'trainer' ? 'Resend to trainer' : 'Send to trainer'}
            </span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Assessments</h2>
              <p className="text-sm text-gray-600 mt-1">
                View all assessments sent to students (pending and submitted) and send completed ones to trainer.
              </p>
            </div>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              {/* Search + filters: stay grouped on the left; wrap on smaller viewports */}
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2 sm:gap-3">
                <Input
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search student, form, or workflow..."
                  className="w-full min-w-0 sm:max-w-[min(100%,280px)] sm:flex-[1_1_200px]"
                />
                <div className="w-full min-w-0 sm:w-[13rem] sm:max-w-[14rem] sm:flex-shrink-0">
                  <SelectAsync
                    value={courseFilter}
                    onChange={(v) => {
                      setCourseFilter(v);
                      setFormFilter('');
                    }}
                    loadOptions={loadCoursesOptions}
                    placeholder="All courses"
                    selectedLabel={courseFilter ? undefined : 'All courses'}
                  />
                </div>
                <div className="w-full min-w-0 sm:w-[15rem] sm:max-w-[16rem] sm:flex-shrink-0">
                  <SelectAsync
                    value={formFilter}
                    onChange={(v) => setFormFilter(v)}
                    loadOptions={loadFormsOptions}
                    placeholder="All forms"
                    selectedLabel={formFilter ? undefined : 'All forms'}
                  />
                </div>
                {/* Not compact: compact mode caps dropdown menu at ~120px wide and truncates labels */}
                <div className="w-full min-w-[12rem] sm:w-[min(100%,18rem)] sm:min-w-[14rem] sm:flex-shrink-0">
                  <Select
                    label="Workflow"
                    value={workflowFilter}
                    onChange={(v) => {
                      setWorkflowFilter(v as AssessmentDirectoryWorkflowFilter);
                      setCurrentPage(1);
                    }}
                    options={WORKFLOW_FILTER_OPTIONS}
                    className="w-full min-w-0"
                  />
                </div>
              </div>
              <div className="flex w-full shrink-0 justify-end xl:w-auto xl:pl-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="inline-flex h-10 min-h-[40px] w-full items-center justify-center gap-2 whitespace-nowrap sm:w-auto"
                >
                  <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </Button>
              </div>
            </div>

          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-lg font-bold text-[var(--text)]">Assessment directory</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 border-[#ea580c]/40 text-[#c2410c] hover:bg-[#fff7ed] sm:ml-auto"
              onClick={() => void massApplyDates()}
              disabled={massApplying || rows.length === 0 || !rows.some(hasRowDateChanges)}
            >
              {massApplying ? 'Applying…' : 'Mass apply'}
            </Button>
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
              itemLabel="assessments"
            />
          )}
          {loading ? (
            <Loader variant="dots" size="lg" message="Loading assessments..." />
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              No assessments sent to students yet.
            </div>
          ) : (
            <>
              <div className="space-y-3 lg:hidden">
                {sortedRows.map((row) => {
                  const missedAttemptText = getMissedAttemptWindowText({
                    noAttemptRollovers: (row as unknown as { no_attempt_rollovers?: number | null }).no_attempt_rollovers ?? null,
                    didNotAttempt: (row as unknown as { did_not_attempt?: boolean | null }).did_not_attempt ?? null,
                  });
                  return (
                  <div
                    key={row.id}
                    className={`rounded-lg border border-[var(--border)] p-4 shadow-sm ${getDirectoryRowClass(row, trainerHighlightCourseId)} cursor-pointer`}
                    onClick={() => setExpandedId((p) => (p === row.id ? null : row.id))}
                    title="Click to view documents"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                        <User className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[var(--text)] break-words">{row.student_name}</div>
                        <div className="text-xs text-gray-500 break-all">{row.student_email || '—'}</div>
                        <div className="mt-2 font-medium text-gray-900 break-words">{row.form_name}</div>
                        <div className="text-xs text-gray-500">Version {row.form_version ?? '1.0.0'}</div>
                        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs text-gray-600">
                          <dt className="text-gray-500">Start</dt>
                          <dd className="min-w-0">
                            {editingDateCell?.id === row.id && editingDateCell.field === 'start' ? (
                              <DatePicker
                                value={getEffectiveStart(row)}
                                onChange={(v) =>
                                  setDateDrafts((prev) => ({
                                    ...prev,
                                    [row.id]: { ...prev[row.id], start: v || null },
                                  }))
                                }
                                compact
                                placement="below"
                                className="max-w-[160px]"
                                disabled={savingDateId === row.id || massApplying}
                                maxDate={getEffectiveEnd(row) || undefined}
                              />
                            ) : (
                              <button
                                type="button"
                                className="text-gray-800 hover:underline text-left"
                                onClick={() => setEditingDateCell({ id: row.id, field: 'start' })}
                                disabled={savingDateId === row.id || massApplying}
                              >
                                {formatDDMMYYYY(getEffectiveStart(row) || row.start_date)}
                              </button>
                            )}
                          </dd>
                          <dt className="text-gray-500">End</dt>
                          <dd className="min-w-0">
                            {editingDateCell?.id === row.id && editingDateCell.field === 'end' ? (
                              <DatePicker
                                value={getEffectiveEnd(row)}
                                onChange={(v) =>
                                  setDateDrafts((prev) => ({
                                    ...prev,
                                    [row.id]: { ...prev[row.id], end: v || null },
                                  }))
                                }
                                compact
                                placement="below"
                                className="max-w-[160px]"
                                disabled={savingDateId === row.id || massApplying}
                                minDate={getEffectiveStart(row) || undefined}
                              />
                            ) : (
                              <button
                                type="button"
                                className="text-gray-800 hover:underline text-left"
                                onClick={() => setEditingDateCell({ id: row.id, field: 'end' })}
                                disabled={savingDateId === row.id || massApplying}
                              >
                                {formatDDMMYYYY(getEffectiveEnd(row) || row.end_date)}
                              </button>
                            )}
                          </dd>
                          <dt className="text-gray-500">Created</dt>
                          <dd>{formatDDMMYYYY(row.created_at)}</dd>
                          <dt className="text-gray-500">Submitted</dt>
                          <dd>{formatDDMMYYYY(row.submitted_at)}</dd>
                        </dl>
                        <div className="mt-2">
                          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${getWorkflowBadgeClass(row)}`}>
                            {getWorkflowLabel(row)}
                          </span>
                        </div>
                        {missedAttemptText ? (
                          <div className="mt-1 text-[11px] font-medium text-amber-700">{missedAttemptText}</div>
                        ) : null}
                        {renderAssessmentActions(row, 'stack')}
                        {expandedId === row.id ? (
                          <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                            <FormDocumentsPanel
                              formId={Number(row.form_id)}
                              formName={String(row.form_name ?? 'Assessment')}
                              canUpload
                              canDelete={viewerIsSuperadmin}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <SortableTh
                        label="Student"
                        className="py-3 pr-3 text-left"
                        active={directorySort.key === 'student'}
                        direction={directorySort.dir}
                        onToggle={() => toggleDirectorySort('student')}
                      />
                      <SortableTh
                        label="Form"
                        className="py-3 pr-3 text-left"
                        active={directorySort.key === 'form'}
                        direction={directorySort.dir}
                        onToggle={() => toggleDirectorySort('form')}
                      />
                      <SortableTh
                        label="Start"
                        className="py-3 pr-3 text-left w-[120px]"
                        active={directorySort.key === 'start'}
                        direction={directorySort.dir}
                        onToggle={() => toggleDirectorySort('start')}
                      />
                      <SortableTh
                        label="End"
                        className="py-3 pr-3 text-left w-[120px]"
                        active={directorySort.key === 'end'}
                        direction={directorySort.dir}
                        onToggle={() => toggleDirectorySort('end')}
                      />
                      <SortableTh
                        label="Created"
                        className="py-3 pr-3 text-left w-[120px]"
                        active={directorySort.key === 'created'}
                        direction={directorySort.dir}
                        onToggle={() => toggleDirectorySort('created')}
                      />
                      <SortableTh
                        label="Workflow"
                        className="py-3 pr-3 text-left w-[140px]"
                        active={directorySort.key === 'workflow'}
                        direction={directorySort.dir}
                        onToggle={() => toggleDirectorySort('workflow')}
                      />
                      <th className="py-3 text-right min-w-[220px] font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row) => {
                      const missedAttemptText = getMissedAttemptWindowText({
                        noAttemptRollovers: (row as unknown as { no_attempt_rollovers?: number | null }).no_attempt_rollovers ?? null,
                        didNotAttempt: (row as unknown as { did_not_attempt?: boolean | null }).did_not_attempt ?? null,
                      });
                      return (
                        <React.Fragment key={row.id}>
                          <tr
                            className={`border-b border-gray-100 ${getDirectoryRowClass(row, trainerHighlightCourseId)} cursor-pointer`}
                            onClick={() => setExpandedId((p) => (p === row.id ? null : row.id))}
                            title="Click to view documents"
                          >
                            <td className="py-3 pr-3">
                              <div className="font-medium text-gray-900">{row.student_name}</div>
                              <div className="text-xs text-gray-500">{row.student_email || '-'}</div>
                            </td>
                        <td className="py-3 pr-3 w-[220px] max-w-[220px] align-top">
                          <div className="font-medium text-gray-900 break-words whitespace-normal leading-snug">
                            {row.form_name}
                          </div>
                          <div className="text-xs text-gray-500 break-words whitespace-normal">Version {row.form_version ?? '1.0.0'}</div>
                        </td>
                        <td className="py-3 pr-3 text-gray-700">
                          {editingDateCell?.id === row.id && editingDateCell.field === 'start' ? (
                            <DatePicker
                              value={getEffectiveStart(row)}
                              onChange={(v) =>
                                setDateDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...prev[row.id], start: v || null },
                                }))
                              }
                              compact
                              placement="below"
                              className="max-w-[160px]"
                              disabled={savingDateId === row.id || massApplying}
                              maxDate={getEffectiveEnd(row) || undefined}
                            />
                          ) : (
                            <button
                              type="button"
                              className="text-gray-700 hover:underline"
                              onClick={() => setEditingDateCell({ id: row.id, field: 'start' })}
                              disabled={savingDateId === row.id || massApplying}
                            >
                              {formatDDMMYYYY(getEffectiveStart(row) || row.start_date)}
                            </button>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-gray-700">
                          {editingDateCell?.id === row.id && editingDateCell.field === 'end' ? (
                            <DatePicker
                              value={getEffectiveEnd(row)}
                              onChange={(v) =>
                                setDateDrafts((prev) => ({
                                  ...prev,
                                  [row.id]: { ...prev[row.id], end: v || null },
                                }))
                              }
                              compact
                              placement="below"
                              className="max-w-[160px]"
                              disabled={savingDateId === row.id || massApplying}
                              minDate={getEffectiveStart(row) || undefined}
                            />
                          ) : (
                            <button
                              type="button"
                              className="text-gray-700 hover:underline"
                              onClick={() => setEditingDateCell({ id: row.id, field: 'end' })}
                              disabled={savingDateId === row.id || massApplying}
                            >
                              {formatDDMMYYYY(getEffectiveEnd(row) || row.end_date)}
                            </button>
                          )}
                        </td>
                        <td className="py-3 pr-3 text-gray-700">{formatDDMMYYYY(row.created_at)}</td>
                        <td className="py-3 pr-3">
                          <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${getWorkflowBadgeClass(row)}`}>
                            {getWorkflowLabel(row)}
                          </span>
                          {missedAttemptText ? (
                            <div className="mt-1 text-[11px] font-medium text-amber-700">{missedAttemptText}</div>
                          ) : null}
                        </td>
                            <td className="py-3 align-middle" onClick={(e) => e.stopPropagation()}>
                              {renderAssessmentActions(row, 'toolbar')}
                            </td>
                          </tr>
                          {expandedId === row.id ? (
                            <tr className={getDirectoryRowClass(row, trainerHighlightCourseId)}>
                              <td colSpan={7} className="pb-4" onClick={(e) => e.stopPropagation()}>
                                <div className="px-3">
                                  <FormDocumentsPanel
                                    formId={Number(row.form_id)}
                                    formName={String(row.form_name ?? 'Assessment')}
                                    canUpload
                                    canDelete={viewerIsSuperadmin}
                                  />
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
            </>
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
              itemLabel="assessments"
            />
          )}
        </Card>

        <Modal
          isOpen={!!sendToTrainerRow}
          onClose={() => {
            setSendToTrainerRow(null);
            setSelectedTrainerId(null);
          }}
          title="Send to Trainer"
          size="md"
        >
          {sendToTrainerRow && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Select a trainer. The assessment link will be copied to your clipboard for you to share with them.
              </p>
              {trainersLoading ? (
                <Loader variant="dots" size="sm" message="Loading trainers..." />
              ) : trainers.length === 0 ? (
                <p className="text-sm text-gray-500 py-4">No trainers found. Add trainers first.</p>
              ) : (
                <div className="max-h-[280px] overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
                  {trainers.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTrainerId(selectedTrainerId === t.id ? null : t.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--brand)]/10 focus-visible:bg-[var(--brand)]/10 transition-colors ${
                        selectedTrainerId === t.id ? 'bg-[var(--brand)]/10 ring-1 ring-[var(--brand)]' : ''
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          selectedTrainerId === t.id ? 'border-[var(--brand)] bg-[var(--brand)]' : 'border-gray-300'
                        }`}
                      >
                        {selectedTrainerId === t.id && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">{t.full_name}{t.role && <span className="ml-2 text-xs font-normal text-gray-500 capitalize">({t.role})</span>}</div>
                        <div className="text-xs text-gray-500 truncate">{t.email}</div>
                      </div>
                      <User className="w-4 h-4 text-gray-400 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => { setSendToTrainerRow(null); setSelectedTrainerId(null); }}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSendToTrainerConfirm}
                  disabled={!selectedTrainerId || sendingId === sendToTrainerRow.id}
                  className="inline-flex items-center gap-2"
                >
                  {sendingId === sendToTrainerRow.id ? (
                    <Loader variant="dots" size="sm" inline />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  <span>{sendingId === sendToTrainerRow.id ? 'Copying...' : 'Copy Link & Close'}</span>
                </Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
};
