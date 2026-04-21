import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { LayoutDashboard, RefreshCw, ExternalLink, Search } from 'lucide-react';
import { requestStudentOtp, studentLoginWithOtp, listStudentAssessmentsPaged, issueInstanceAccessLink } from '../lib/formEngine';
import type { SubmittedInstanceRow } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';
import { AdminListPagination } from '../components/admin/AdminListPagination';
import { isValidInstitutionalEmail } from '../lib/emailUtils';

const MEL_TZ = 'Australia/Melbourne';
const melDate = (d: Date): string => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: MEL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(d);
};

const formatDDMMYYYY = (value: string | null): string => {
  const v = (value ?? '').trim();
  if (!v) return '—';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return v;
};

const withinWindowMelbourne = (row: Pick<SubmittedInstanceRow, 'start_date' | 'end_date'>): { ok: boolean; reason?: string } => {
  const today = melDate(new Date());
  const start = String(row.start_date ?? '').trim();
  const end = String(row.end_date ?? '').trim();
  if (start && today < start) return { ok: false, reason: `Available from ${formatDDMMYYYY(start)}` };
  if (end && today > end) return { ok: false, reason: `Expired on ${formatDDMMYYYY(end)} (23:59 AEDT)` };
  return { ok: true };
};

const STORAGE_KEY = 'signflow_student_dashboard_auth_v1';

export const StudentDashboardPage: React.FC = () => {
  const PAGE_SIZE = 20;
  const [studentId, setStudentId] = useState<number | null>(null);
  const [studentEmail, setStudentEmail] = useState<string>('');

  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [rows, setRows] = useState<SubmittedInstanceRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as { studentId?: number; email?: string; at?: number };
      const sid = Number(j?.studentId);
      if (Number.isFinite(sid) && sid > 0) {
        setStudentId(sid);
        setStudentEmail(String(j?.email ?? ''));
      }
    } catch {
      // ignore
    }
  }, []);

  const emailValid = isValidInstitutionalEmail(email);
  const canSendOtp = !!email.trim() && emailValid && !otpSent;
  const canVerifyOtp = !!email.trim() && otp.trim().length >= 6;

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const loadRows = useCallback(
    async (page: number, search: string, opts?: { silent?: boolean }) => {
      if (!studentId) return;
      if (!opts?.silent) setLoading(true);
      const res = await listStudentAssessmentsPaged(studentId, page, PAGE_SIZE, search.trim() || undefined);
      setRows(res.data);
      setTotalRows(res.total);
      setLoading(false);
    },
    [studentId]
  );

  useEffect(() => {
    if (!studentId) return;
    const t = setTimeout(() => void loadRows(currentPage, searchTerm), 250);
    return () => clearTimeout(t);
  }, [studentId, currentPage, searchTerm, loadRows]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, studentId]);

  const handleSendOtp = async () => {
    if (!email.trim() || !emailValid) return;
    setAuthSubmitting(true);
    const res = await requestStudentOtp(email.trim());
    setAuthSubmitting(false);
    if (res.success) {
      setOtpSent(true);
      toast.success(res.message || 'OTP sent. Check your email.');
    } else {
      toast.error(res.message || 'Failed to send OTP');
    }
  };

  const handleVerifyOtp = async () => {
    if (!email.trim() || !otp.trim() || !emailValid) return;
    setAuthSubmitting(true);
    const res = await studentLoginWithOtp(email.trim(), otp.trim());
    setAuthSubmitting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setStudentId(res.studentId);
    setStudentEmail(res.email);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ studentId: res.studentId, email: res.email, at: Date.now() }));
    setOtp('');
    setOtpSent(false);
    toast.success('Welcome');
  };

  const handleRefresh = async () => {
    if (!studentId) return;
    setRefreshing(true);
    await loadRows(currentPage, searchTerm, { silent: true });
    setRefreshing(false);
    toast.success('Refreshed');
  };

  const handleOpen = async (row: SubmittedInstanceRow) => {
    const win = withinWindowMelbourne(row);
    if (!win.ok) {
      toast.error(win.reason || 'This assessment is not available right now.');
      return;
    }
    const url = await issueInstanceAccessLink(row.id, 'student');
    if (!url) {
      toast.error('Could not open. This assessment may be outside the allowed window.');
      return;
    }
    window.open(url, '_blank');
  };

  const logout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setStudentId(null);
    setStudentEmail('');
    setRows([]);
    setTotalRows(0);
    setCurrentPage(1);
    setSearchTerm('');
    setEmail('');
    setOtp('');
    setOtpSent(false);
  };

  const headerRight = useMemo(() => {
    if (!studentId) return null;
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 inline ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={logout}>
          Logout
        </Button>
      </div>
    );
  }, [studentId, refreshing, handleRefresh]);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6 max-w-6xl mx-auto space-y-4">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
                <LayoutDashboard className="w-7 h-7 text-[var(--brand)]" />
                Student dashboard
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                {studentId ? (
                  <>
                    Signed in as <span className="font-medium text-gray-800 break-all">{studentEmail || 'student'}</span>. Open is only allowed between start date and end date (until 23:59 AEDT).
                  </>
                ) : (
                  <>Sign in with OTP to see your assessments.</>
                )}
              </p>
            </div>
            {headerRight}
          </div>
        </Card>

        {!studentId ? (
          <Card className="max-w-xl">
            <div className="space-y-4">
              <div>
                <Input
                  type="email"
                  label="Email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (otpSent) setOtpSent(false);
                  }}
                  placeholder="firstname.lastname@student.slit.edu.au"
                  autoComplete="email"
                  className={email.trim() && !emailValid ? 'border-amber-500' : ''}
                />
                {email.trim() && !emailValid ? (
                  <p className="mt-1.5 text-sm text-amber-600">Only @student.slit.edu.au or @slit.edu.au emails can access.</p>
                ) : null}
              </div>
              {!otpSent ? (
                <Button type="button" onClick={handleSendOtp} disabled={authSubmitting || !canSendOtp} className="w-full">
                  {authSubmitting ? 'Sending…' : 'Send OTP'}
                </Button>
              ) : (
                <div className="space-y-3">
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    label="6-digit OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    autoComplete="one-time-code"
                    className="text-center text-lg tracking-widest"
                  />
                  <Button type="button" onClick={handleVerifyOtp} disabled={authSubmitting || !canVerifyOtp} className="w-full">
                    {authSubmitting ? 'Verifying…' : 'View my assessments'}
                  </Button>
                  <button type="button" onClick={() => { setOtpSent(false); setOtp(''); }} className="w-full text-sm text-gray-500 hover:text-gray-700">
                    Use a different email or resend OTP
                  </button>
                </div>
              )}
            </div>
          </Card>
        ) : (
          <Card>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-[var(--text)]">My assessments</h2>
                <p className="text-sm text-gray-600 mt-1">Open is enabled only during the allowed date window.</p>
              </div>
              <div className="relative w-full md:w-[320px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search unit or status…"
                  className="!pl-10 w-full"
                />
              </div>
            </div>

            {!loading && totalRows > 0 ? (
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

            {loading ? (
              <div className="py-12">
                <Loader variant="dots" size="lg" message="Loading assessments..." />
              </div>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">No assessments found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[860px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Unit</th>
                      <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)] w-[120px]">Start</th>
                      <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)] w-[120px]">End</th>
                      <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)] w-[180px]">Status</th>
                      <th className="text-right px-4 py-3 font-semibold border-b border-[var(--border)] w-[160px]">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const win = withinWindowMelbourne(row);
                      const disabled = !win.ok;
                      return (
                        <tr key={row.id} className="hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10 transition-colors">
                          <td className="px-4 py-3 border-b border-[var(--border)]">
                            <div className="font-medium text-[var(--text)] break-words">{row.form_name}</div>
                            <div className="text-xs text-gray-500">Version {row.form_version ?? '1.0.0'}</div>
                          </td>
                          <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700 whitespace-nowrap">{formatDDMMYYYY(row.start_date)}</td>
                          <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700 whitespace-nowrap">{formatDDMMYYYY(row.end_date)}</td>
                          <td className="px-4 py-3 border-b border-[var(--border)]">
                            <div className="text-gray-700">{row.status}</div>
                            {!win.ok ? <div className="text-xs text-amber-700 mt-1">{win.reason}</div> : null}
                          </td>
                          <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                            <Button variant="outline" size="sm" onClick={() => void handleOpen(row)} disabled={disabled}>
                              <ExternalLink className="w-4 h-4 mr-2 inline" />
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

            {!loading && totalRows > 0 ? (
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
            ) : null}
          </Card>
        )}
      </div>
    </div>
  );
};

