import React, { useEffect, useState, useCallback } from 'react';
import { ExternalLink, RefreshCw, ClipboardCheck, LayoutDashboard, Users } from 'lucide-react';
import { listDashboardInstances, getDashboardPendingCount, getTrainerBatchCount, listTrainerBatches, listStudentsInBatch, issueInstanceAccessLink } from '../lib/formEngine';
import type { SubmittedInstanceRow, Batch, Student } from '../lib/formEngine';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';
import { AdminListPagination } from '../components/admin/AdminListPagination';

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
  return 'Submitted';
};

const getWorkflowBadgeClass = (row: SubmittedInstanceRow): string => {
  if (row.status === 'locked') return 'bg-emerald-100 text-emerald-800';
  if (row.status === 'draft') return 'bg-slate-100 text-slate-700';
  if (row.role_context === 'trainer') return 'bg-amber-100 text-amber-800';
  if (row.role_context === 'office') return 'bg-blue-100 text-blue-800';
  return 'bg-gray-100 text-gray-700';
};

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
    const targetRole =
      row.role_context === 'trainer' ? 'trainer'
      : row.role_context === 'office' ? 'office'
      : row.status === 'locked' ? (role === 'office' ? 'office' : 'trainer')
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
            <h2 className="text-lg font-bold text-[var(--text)]">Pending assessments</h2>
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-3 pr-3">Student</th>
                    <th className="py-3 pr-3">Form</th>
                    <th className="py-3 pr-3">Date</th>
                    <th className="py-3 pr-3">Workflow</th>
                    <th className="py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors">
                      <td className="py-3 pr-3">
                        <div className="font-medium text-gray-900">{row.student_name}</div>
                        <div className="text-xs text-gray-500">{row.student_email || '-'}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-medium text-gray-900">{row.form_name}</div>
                        <div className="text-xs text-gray-500">v{row.form_version ?? '1.0.0'}</div>
                      </td>
                      <td className="py-3 pr-3 text-gray-700">{formatDateTime(row.submitted_at || row.created_at)}</td>
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getWorkflowBadgeClass(row)}`}
                        >
                          {getWorkflowLabel(row)}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpen(row)}
                          className="inline-flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-4 h-4" />
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
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
