import React, { useEffect, useState, useCallback } from 'react';
import { Copy, ExternalLink, Send, RefreshCw, Ban, CheckCircle, User, CalendarClock, CalendarDays } from 'lucide-react';
import { listSubmittedInstancesPaged, updateInstanceRole, updateInstanceWorkflowStatus, issueInstanceAccessLink, getOrIssueInstanceAccessLink, revokeRoleAccessTokens, extendInstanceAccessTokens, extendInstanceAccessTokensToDate, allowStudentResubmission, listTrainers, updateFormInstanceDates, listCoursesPaged, listFormsPaged } from '../lib/formEngine';
import type { SubmittedInstanceRow, Trainer } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { DatePicker } from '../components/ui/DatePicker';
import { SelectAsync } from '../components/ui/SelectAsync';
import { Loader } from '../components/ui/Loader';
import { Modal } from '../components/ui/Modal';
import { toast } from '../utils/toast';

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

const getWorkflowBadgeClass = (row: SubmittedInstanceRow): string => {
  const base = 'border border-gray-200/80';
  if (row.status === 'locked') return `${base} bg-emerald-50 text-emerald-800`;
  if (row.role_context === 'trainer') return `${base} bg-amber-50 text-amber-800`;
  if (row.role_context === 'office') return `${base} bg-sky-50 text-sky-800`;
  if (row.status === 'draft') return `${base} bg-gray-50 text-gray-700`;
  return `${base} bg-gray-50 text-gray-600`;
};

export const AdminAssessmentsPage: React.FC = () => {
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
  const [sendToTrainerRow, setSendToTrainerRow] = useState<SubmittedInstanceRow | null>(null);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [trainersLoading, setTrainersLoading] = useState(false);
  const [selectedTrainerId, setSelectedTrainerId] = useState<number | null>(null);
  const [extendDeadlineRow, setExtendDeadlineRow] = useState<SubmittedInstanceRow | null>(null);
  const [extendDeadlineNewDate, setExtendDeadlineNewDate] = useState('');
  const [extending, setExtending] = useState(false);
  const [editDatesRow, setEditDatesRow] = useState<SubmittedInstanceRow | null>(null);
  const [editDatesStart, setEditDatesStart] = useState('');
  const [editDatesEnd, setEditDatesEnd] = useState('');
  const [savingDates, setSavingDates] = useState(false);

  const loadRows = useCallback(async (page: number, search: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const courseId = courseFilter ? Number(courseFilter) : undefined;
    const formId = formFilter ? Number(formFilter) : undefined;
    const res = await listSubmittedInstancesPaged(page, PAGE_SIZE, search, courseId, formId);
    setRows(res.data);
    setTotalRows(res.total);
    setLoading(false);
  }, [courseFilter, formFilter]);

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
  }, [searchTerm, courseFilter, formFilter]);

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
    setSendToTrainerRow(row);
    setSelectedTrainerId(null);
    setTrainersLoading(true);
    listTrainers().then((list) => {
      setTrainers(list);
      setTrainersLoading(false);
    });
  };

  const openExtendDeadline = (row: SubmittedInstanceRow) => {
    setExtendDeadlineRow(row);
    setExtendDeadlineNewDate((row.end_date ?? '').trim() || new Date().toISOString().slice(0, 10));
  };

  const openEditDates = (row: SubmittedInstanceRow) => {
    setEditDatesRow(row);
    setEditDatesStart((row.start_date ?? '').trim() || new Date().toISOString().slice(0, 10));
    setEditDatesEnd((row.end_date ?? '').trim() || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  };

  const handleSaveDates = async () => {
    if (!editDatesRow) return;
    const start = editDatesStart.trim();
    const end = editDatesEnd.trim();
    if (!start || !end) {
      toast.error('Select start and end date');
      return;
    }
    if (end < start) {
      toast.error('End date cannot be earlier than start date');
      return;
    }
    setSavingDates(true);
    await updateFormInstanceDates(editDatesRow.id, { start_date: start });
    await extendInstanceAccessTokensToDate(editDatesRow.id, 'student', end);
    setSavingDates(false);
    setEditDatesRow(null);
    await loadRows(currentPage, searchTerm, { silent: true });
    toast.success('Assessment dates updated');
  };

  const handleExtendDeadlineConfirm = async () => {
    if (!extendDeadlineRow || !extendDeadlineNewDate.trim()) return;
    const newDate = extendDeadlineNewDate.trim();
    const studentName = extendDeadlineRow.student_name;
    setExtending(true);
    await extendInstanceAccessTokensToDate(extendDeadlineRow.id, 'student', newDate);
    setExtending(false);
    setExtendDeadlineRow(null);
    setExtendDeadlineNewDate('');
    await loadRows(currentPage, searchTerm, { silent: true });
    toast.success(`${studentName}'s assessment end date extended. They can access until ${newDate} 11:59 PM.`);
  };

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
            <div className="flex flex-col lg:flex-row lg:flex-nowrap lg:items-center lg:justify-start gap-2 lg:gap-2">
              <Input
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search student, form, or workflow..."
                className="w-full lg:flex-1 lg:min-w-[220px] lg:max-w-none"
              />
              <div className="w-full lg:w-52 lg:shrink-0">
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
              <div className="w-full lg:w-60 lg:shrink-0">
                <SelectAsync
                  value={formFilter}
                  onChange={(v) => setFormFilter(v)}
                  loadOptions={loadFormsOptions}
                  placeholder="All forms"
                  selectedLabel={formFilter ? undefined : 'All forms'}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap w-full lg:w-auto"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          {loading ? (
            <Loader variant="dots" size="lg" message="Loading assessments..." />
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              No assessments sent to students yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 pr-3">Student</th>
                    <th className="py-3 pr-3">Form</th>
                    <th className="py-3 pr-3 w-[120px]">Start</th>
                    <th className="py-3 pr-3 w-[120px]">End</th>
                    <th className="py-3 pr-3">Date</th>
                    <th className="py-3 pr-3 w-[140px]">Workflow</th>
                    <th className="py-3 text-right min-w-[220px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 pr-3">
                        <div className="font-medium text-gray-900">{row.student_name}</div>
                        <div className="text-xs text-gray-500">{row.student_email || '-'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-medium text-gray-900">{row.form_name}</div>
                        <div className="text-xs text-gray-500">Version {row.form_version ?? '1.0.0'}</div>
                      </td>
                      <td className="py-3 pr-3 text-gray-700">{formatDDMMYYYY(row.start_date)}</td>
                      <td className="py-3 pr-3 text-gray-700">{formatDDMMYYYY(row.end_date)}</td>
                      <td className="py-3 pr-3 text-gray-700">{formatDDMMYYYY(row.submitted_at || row.created_at)}</td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${getWorkflowBadgeClass(row)}`}>
                          {getWorkflowLabel(row)}
                        </span>
                      </td>
                      <td className="py-3 align-middle">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {(() => {
                            const actionBtn = 'group inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-[var(--brand)]/10 hover:border-[var(--brand)]/40 hover:text-[var(--brand)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-200 disabled:hover:text-gray-600 text-xs font-medium';
                            const actionIcon = 'w-3 h-3 shrink-0';
                            const actionText = 'max-w-0 overflow-hidden group-hover:max-w-[8rem] transition-all duration-200 whitespace-nowrap';
                            return (
                              <>
                                <button type="button" onClick={async () => { const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student'; const url = await getOrIssueInstanceAccessLink(row.id, role); if (!url) { toast.error('Failed to open secure link'); return; } window.open(url, '_blank'); }} className={actionBtn} title="Open">
                                  <ExternalLink className={actionIcon} />
                                  <span className={actionText}>Open</span>
                                </button>
                                <button type="button" onClick={() => { const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student'; handleCopyLink(row.id, role); }} className={actionBtn} title="Copy Link">
                                  <Copy className={actionIcon} />
                                  <span className={actionText}>Copy Link</span>
                                </button>
                                {!row.link_expired && (
                                  <button type="button" onClick={() => { const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student'; void handleExpireLink(row.id, role); }} disabled={managingId === row.id} className={actionBtn} title="Revoke link access">
                                    <Ban className={actionIcon} />
                                    <span className={actionText}>Expire</span>
                                  </button>
                                )}
                                {row.link_expired && (
                                  <button type="button" onClick={() => { const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student'; void handleEnableLink(row.id, role); }} disabled={managingId === row.id} className={actionBtn} title="Re-enable link (30 days)">
                                    <CheckCircle className={actionIcon} />
                                    <span className={actionText}>Enable</span>
                                  </button>
                                )}
                                <button type="button" onClick={() => openExtendDeadline(row)} className={actionBtn} title="Extend assessment end date">
                                  <CalendarClock className={actionIcon} />
                                  <span className={actionText}>Extend End Date</span>
                                </button>
                                <button type="button" onClick={() => openEditDates(row)} className={actionBtn} title="Edit assessment dates">
                                  <CalendarDays className={actionIcon} />
                                  <span className={actionText}>Edit dates</span>
                                </button>
                                {row.status !== 'locked' &&
                                  (row.role_context === 'trainer' || row.role_context === 'office') &&
                                  (Number((row as unknown as { submission_count?: number }).submission_count ?? 0) > 0 || !!row.submitted_at) &&
                                  // Max 3 student submissions/attempts; don't show when all attempts used.
                                  Number((row as unknown as { submission_count?: number }).submission_count ?? 0) < 3 && (
                                  <button type="button" onClick={async () => { setManagingId(row.id); await allowStudentResubmission(row.id); setManagingId(null); await loadRows(currentPage, searchTerm, { silent: true }); const url = `${window.location.origin}/forms/${row.form_id}/student-access`; await navigator.clipboard.writeText(url); toast.success('Resubmission allowed. Generic link copied—student uses email and OTP.'); }} disabled={managingId === row.id} className={actionBtn} title="Allow student to resubmit">
                                    <CheckCircle className={actionIcon} />
                                    <span className={actionText}>Allow Resubmission</span>
                                  </button>
                                )}
                                {(row.status === 'submitted' || row.status === 'draft') && (
                                  <button
                                    type="button"
                                    onClick={() => openSendToTrainer(row)}
                                    disabled={sendingId === row.id}
                                    className={actionBtn}
                                    title={row.role_context === 'trainer' ? 'Resend to Trainer' : 'Send to Trainer'}
                                  >
                                    <Send className={actionIcon} />
                                    <span className={actionText}>{sendingId === row.id ? 'Sending...' : row.role_context === 'trainer' ? 'Resend to Trainer' : 'Send to Trainer'}</span>
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && totalRows > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="text-xs text-gray-500">Page {currentPage} of {totalPages} ({totalRows} total)</div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
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
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors ${
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

        <Modal
          isOpen={!!extendDeadlineRow}
          onClose={() => {
            setExtendDeadlineRow(null);
            setExtendDeadlineNewDate('');
          }}
          title="Extend assessment end date (this instance only)"
          size="md"
        >
          {extendDeadlineRow && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Extend <strong>{extendDeadlineRow.student_name}</strong>'s assessment end date for <strong>{extendDeadlineRow.form_name}</strong>. Only this student is affected.
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">New end date (end of day)</label>
                <DatePicker
                  value={extendDeadlineNewDate}
                  onChange={(v) => setExtendDeadlineNewDate(v || '')}
                  className="max-w-[180px]"
                  fromYear={new Date().getFullYear()}
                  toYear={new Date().getFullYear() + 2}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setExtendDeadlineRow(null);
                    setExtendDeadlineNewDate('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleExtendDeadlineConfirm}
                  disabled={!extendDeadlineNewDate.trim() || extending}
                  className="inline-flex items-center gap-2"
                >
                  {extending ? (
                    <Loader variant="dots" size="sm" inline />
                  ) : (
                    <CalendarClock className="w-4 h-4" />
                  )}
                  <span>{extending ? 'Updating...' : 'Extend deadline'}</span>
                </Button>
              </div>
            </div>
          )}
        </Modal>

        <Modal
          isOpen={!!editDatesRow}
          onClose={() => {
            setEditDatesRow(null);
            setEditDatesStart('');
            setEditDatesEnd('');
          }}
          title="Edit assessment dates (this instance only)"
          size="md"
        >
          {editDatesRow && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Update start/end dates for <strong>{editDatesRow.student_name}</strong> — <strong>{editDatesRow.form_name}</strong>.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">Start date</span>
                  <DatePicker value={editDatesStart} onChange={(v) => setEditDatesStart(v || '')} className="mt-1 max-w-[180px]" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">End date</span>
                  <DatePicker value={editDatesEnd} onChange={(v) => setEditDatesEnd(v || '')} className="mt-1 max-w-[180px]" minDate={editDatesStart || undefined} />
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditDatesRow(null)} disabled={savingDates}>
                  Cancel
                </Button>
                <Button onClick={handleSaveDates} disabled={savingDates || !editDatesStart.trim() || !editDatesEnd.trim()}>
                  {savingDates ? <Loader variant="dots" size="sm" inline className="mr-2" /> : null}
                  Save
                </Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
};
