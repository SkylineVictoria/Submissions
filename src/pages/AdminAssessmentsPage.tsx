import React, { useEffect, useState, useCallback } from 'react';
import { Copy, ExternalLink, Send, RefreshCw, Ban, CheckCircle, User } from 'lucide-react';
import { listSubmittedInstancesPaged, updateInstanceRole, issueInstanceAccessLink, revokeRoleAccessTokens, extendInstanceAccessTokens, allowStudentResubmission, listTrainers } from '../lib/formEngine';
import type { SubmittedInstanceRow, Trainer } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Loader } from '../components/ui/Loader';
import { Modal } from '../components/ui/Modal';
import { toast } from '../utils/toast';

const formatDateTime = (value: string | null): string => {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString();
};

const getWorkflowLabel = (row: SubmittedInstanceRow): string => {
  if (row.status === 'locked') return 'Completed';
  if (row.status === 'draft') return 'Awaiting Student';
  if (row.role_context === 'trainer') return 'Waiting Trainer';
  if (row.role_context === 'office') return 'Waiting Office';
  return 'Submitted (Not Sent)';
};

const getWorkflowBadgeClass = (row: SubmittedInstanceRow): string => {
  const base = 'border border-gray-200/80';
  if (row.status === 'locked') return `${base} bg-emerald-50 text-emerald-800`;
  if (row.status === 'draft') return `${base} bg-gray-50 text-gray-700`;
  if (row.role_context === 'trainer') return `${base} bg-amber-50 text-amber-800`;
  if (row.role_context === 'office') return `${base} bg-sky-50 text-sky-800`;
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
  const [sendToTrainerRow, setSendToTrainerRow] = useState<SubmittedInstanceRow | null>(null);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [trainersLoading, setTrainersLoading] = useState(false);
  const [selectedTrainerId, setSelectedTrainerId] = useState<number | null>(null);

  const loadRows = useCallback(async (page: number, search: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const res = await listSubmittedInstancesPaged(page, PAGE_SIZE, search);
    setRows(res.data);
    setTotalRows(res.total);
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      loadRows(currentPage, searchTerm);
    }, 250);
    return () => clearTimeout(t);
  }, [currentPage, searchTerm, loadRows]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadRows(currentPage, searchTerm, { silent: true });
    setRefreshing(false);
    toast.success('Assessments refreshed');
  };

  const handleCopyLink = async (instanceId: number, roleContext: 'student' | 'trainer' | 'office') => {
    const url = await issueInstanceAccessLink(instanceId, roleContext);
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
    toast.success('Link re-enabled for 30 days. Student/trainer can access even if form date passed.');
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

  const handleSendToTrainerConfirm = async () => {
    if (!sendToTrainerRow || !selectedTrainerId) return;
    const trainer = trainers.find((t) => t.id === selectedTrainerId);
    setSendingId(sendToTrainerRow.id);
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
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Assessments</h2>
              <p className="text-sm text-gray-600 mt-1">
                View all assessments sent to students (pending and submitted) and send completed ones to trainer.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search student, form, or workflow..."
                className="w-[260px]"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-2 whitespace-nowrap"
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
                    <th className="py-3 pr-3">Date</th>
                    <th className="py-3 pr-3 w-[140px]">Workflow</th>
                    <th className="py-3 text-right min-w-[320px]">Actions</th>
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
                      <td className="py-3 pr-3 text-gray-700">{formatDateTime(row.submitted_at || row.created_at)}</td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-medium ${getWorkflowBadgeClass(row)}`}>
                          {getWorkflowLabel(row)}
                        </span>
                      </td>
                      <td className="py-3 align-middle">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student';
                              const url = await issueInstanceAccessLink(row.id, role);
                              if (!url) {
                                toast.error('Failed to open secure link');
                                return;
                              }
                              window.open(url, '_blank');
                            }}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <ExternalLink className="w-4 h-4" />
                            <span>Open</span>
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student';
                              handleCopyLink(row.id, role);
                            }}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <Copy className="w-4 h-4" />
                            <span>Copy Link</span>
                          </Button>
                          {!row.link_expired && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student';
                                void handleExpireLink(row.id, role);
                              }}
                              disabled={managingId === row.id}
                              className="inline-flex items-center gap-1.5 whitespace-nowrap"
                              title="Revoke link access"
                            >
                              <Ban className="w-4 h-4" />
                              <span>Expire</span>
                            </Button>
                          )}
                          {row.link_expired && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student';
                                void handleEnableLink(row.id, role);
                              }}
                              disabled={managingId === row.id}
                              className="inline-flex items-center gap-1.5 whitespace-nowrap"
                              title="Re-enable link (30 days) even if form date passed"
                            >
                              <CheckCircle className="w-4 h-4" />
                              <span>Enable</span>
                            </Button>
                          )}
                          {row.status === 'submitted' && (row.role_context === 'trainer' || row.role_context === 'office') && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                setManagingId(row.id);
                                await allowStudentResubmission(row.id);
                                setManagingId(null);
                                await loadRows(currentPage, searchTerm, { silent: true });
                                const url = `${window.location.origin}/forms/${row.form_id}/student-access`;
                                await navigator.clipboard.writeText(url);
                                toast.success('Resubmission allowed. Generic link copied—student uses email and password.');
                              }}
                              disabled={managingId === row.id}
                              className="inline-flex items-center gap-1.5 whitespace-nowrap"
                              title="Allow student to resubmit (2nd/3rd attempt)"
                            >
                              <CheckCircle className="w-4 h-4" />
                              <span>Allow Resubmission</span>
                            </Button>
                          )}
                          {row.status === 'submitted' && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openSendToTrainer(row)}
                              disabled={sendingId === row.id}
                              className="inline-flex items-center gap-1.5 whitespace-nowrap"
                            >
                              <Send className="w-4 h-4" />
                              <span>
                                {sendingId === row.id
                                  ? 'Sending...'
                                  : row.role_context === 'trainer'
                                    ? 'Resend to Trainer'
                                    : 'Send to Trainer'}
                              </span>
                            </Button>
                          )}
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
                        <div className="font-medium text-gray-900 truncate">{t.full_name}</div>
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
